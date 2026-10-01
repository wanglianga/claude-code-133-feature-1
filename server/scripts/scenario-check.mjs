#!/usr/bin/env node
/**
 * 云顶山观光车调度平台 —— 后端端到端场景校验
 *
 * 运行前提：后端已在全新种子库上启动（默认 http://localhost:3001/api）
 *   cd server && rm -f data/app.sqlite && npm start
 * 然后：
 *   node server/scripts/scenario-check.mjs
 *
 * 覆盖：优先检票 / 始发站校验 / 满载跳站解释（原因+车内人数+下一班ETA+补偿+换乘）
 *       站点负责人确认 / 留座规则检票锁定 / 临时增派空车 / 调度主管复核
 *       游客投诉→客服同记录办结 / 派班多重阻断 / 安检不合格转维保 / 反方向拦截
 *       车辆故障 / 退票核准→财务出账 / 争议升级主管裁决 / 暴雨停运与派班阻断
 *       交班延误 / 包车座位轮椅校验 / 广播限流 / 车票时间线 / 复盘报表
 */

const BASE = process.env.API_BASE || 'http://localhost:3001/api';

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}`); }
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data };
}
const get = p => req('GET', p).then(r => r.data);
const post = (p, b) => req('POST', p, b ?? {});

async function expectFail(p, body, keywords, label) {
  const r = await post(p, body);
  const msg = r.data?.message || '';
  check(!r.ok && keywords.every(k => msg.includes(k)), `${label}（阻断原因含：${keywords.join('/')}）｜实际：${msg}`);
  return r;
}

async function buy(partial) {
  const r = await post('/tickets', { type: 'single', partySize: 1, ...partial });
  if (!r.ok) throw new Error('购票失败：' + r.data?.message);
  return r.data;
}
async function enqueue(stationId, code) {
  const r = await post(`/stations/${stationId}/enqueue`, { ticketCode: code });
  if (!r.ok) throw new Error(`入队失败 ${code}：${r.data?.message}`);
  return r.data;
}
async function boardNext(stationId, tripId) {
  const r = await post(`/stations/${stationId}/board-next`, { tripId });
  return r.data;
}

async function main() {
  console.log('\n=== 0. 种子数据自检 ===');
  const overview = await get('/overview');
  check(overview.stations.length === 10, '种子 10 个站点');
  check(overview.activeTrips >= 1, '存在在途班次');
  const seedOpenSkips = await get('/skip-records/open');
  const seedSkip = seedOpenSkips.find(s => s.stationId === 3);
  check(!!seedSkip && seedSkip.onboardCount === 10 && seedSkip.nextEtaMinutes > 0,
    `种子满载跳站记录 ${seedSkip?.code}：车内 10/10、下一班有 ETA`);

  console.log('\n=== 1. 种子跳站记录：站点负责人确认 → 主管复核 → 自动闭环 ===');
  // 复核前必须先站点确认
  await expectFail(`/skip-records/${seedSkip.id}/dispatch-review`, { note: 'x' }, ['站点负责人确认'], '未确认先复核被阻断');
  let r = await post(`/skip-records/${seedSkip.id}/station-confirm`, { managerName: '赵站长', note: '情况属实' });
  check(r.data.status === 'station_confirmed' && r.data.stationConfirmedBy === '赵站长', '站点负责人确认成功');
  r = await post(`/skip-records/${seedSkip.id}/dispatch-review`, { reviewerName: '钱主管' });
  check(r.data.status === 'closed' && !!r.data.closedAt, '主管复核后无投诉自动闭环');

  console.log('\n=== 2. 优先检票（优先组优先 + 同组 FIFO）===');
  const t3 = await get('/tickets/code/T20261001-003'); // 孙老先生 轮椅优先 2人
  const board1 = await get('/stations/1/board');
  check(board1.queue[0]?.ticketId === t3.ticket.id, '看板队列首位为优先组孙老先生');
  let b = await boardNext(1, 1);
  check(b.ok && b.entry.ticketId === t3.ticket.id, '一键叫号首先检入优先组');
  b = await boardNext(1, 1); // 张敏 2人
  check(b.ok, '随后按 FIFO 检入普通组');
  await boardNext(1, 1); // 刘芳 3人
  await boardNext(1, 1); // 周杰 4人（环线票）
  const trip1Now = (await get('/dispatch/dashboard')).trips.find(t => t.id === 1);
  check(trip1Now.seatsSold === 13, '四组检票后车上 13/14 人');

  console.log('\n=== 3. 始发站校验 ===');
  const wrongOrigin = await buy({ visitorName: '站错队', originStationId: 2, destStationId: 4 });
  await expectFail('/stations/1/enqueue', { ticketCode: wrongOrigin.code }, ['始发站'], '非票面始发站入队被拦截');

  console.log('\n=== 4. 卖满车辆 + 满载跳站解释自动生成 ===');
  // 百花园先排 2 名游客
  const vA = await buy({ visitorName: '被跳甲等', originStationId: 2, destStationId: 4 });
  const vB = await buy({ visitorName: '被跳乙等', type: 'accessible_priority', hasElder: true, needWheelchair: true, originStationId: 2, destStationId: 4 });
  await enqueue(2, vA.code);
  await enqueue(2, vB.code);
  // 东门票务补足最后 1 座并卖满
  const fill = await buy({ visitorName: '补满座位', originStationId: 1, destStationId: 3 });
  await enqueue(1, fill.code);
  b = await boardNext(1, 1);
  check(b.ok, '最后 1 座检票成功');
  b = await boardNext(1, 1);
  check(!b.ok && b.seatsLeft === 0, '无余座时叫号返回满载');
  // 车辆到站百花园 → 自动跳站
  const arr = (await post('/trips/1/arrive', { stationId: 2 })).data;
  check(arr.skipped && arr.seatsLeft === 0, '满载到站自动判定跳站');
  check(!!arr.skipRecordCode, `自动生成跳站解释记录 ${arr.skipRecordCode}`);
  check(arr.nextEtaMinutes > 0 && arr.compensation && arr.transferAdvice,
    '跳站解释含下一班预计到达/等待补偿/换乘建议');
  const skipId = arr.skipRecordId;
  const skipRec = await get(`/skip-records/${skipId}`);
  check(skipRec.onboardCount === 14 && skipRec.capacity === 14 && skipRec.waitingPeople === 2,
    '记录车内人数 14/14、滞留 2 人');
  check(skipRec.reason.includes('满载') || skipRec.reason.includes('余量为 0'), '记录跳站原因');
  // 各端同步
  const board2 = await get('/stations/2/board');
  check(board2.skipRecords.some(s => s.id === skipId), '站点端同步看到同一条跳站记录与等候策略');
  const dash = await get('/dispatch/dashboard');
  check(dash.skipRecords.some(s => s.id === skipId), '调度端同步看到跳站记录');
  check(dash.suggestions.some(s => s.text.includes('满载跳站')), '调度建议提示处置跳站');
  const detailA = await get(`/tickets/code/${vA.code}`);
  check(detailA.skipRecords.some(s => s.id === skipId), '游客车票详情显示跳站解释');
  // 滞留组状态
  check(skipRec.affectedGroups.some(g => g.queueStatus === 'skipped'), '受影响游客标记为滞留');

  console.log('\n=== 5. 站点负责人确认（复核前置）===');
  await expectFail(`/skip-records/${skipId}/dispatch-review`, { note: 'x' }, ['站点负责人确认'], '调度主管复核须站点先确认');
  r = await post(`/skip-records/${skipId}/station-confirm`, { managerName: '孙站长', note: '现场确认满载，已广播安抚' });
  check(r.data.status === 'station_confirmed', '站点负责人确认完成');

  console.log('\n=== 6. 不满载离站规则（留座 3）→ 上游检票链路强制锁定 ===');
  r = await post(`/skip-records/${skipId}/seat-reserve`, { seats: 3, note: '后续车为百花园留3座' });
  check(r.data.seatReserveSet === 3, '调度下发留座规则 3 座');
  const board2b = await get('/stations/2/board');
  check(board2b.seatReserve === 3, '站点端看到留座规则');
  // 安检：V04 不合格转维保；V01+王建国 合格
  const failCheck = (await post('/safety-checks', {
    vehicleId: 4, driverId: 1,
    items: { brake: true, lights: false, doors: true },
  })).data;
  check(failCheck.passed === false, '安检不合格被判定');
  const v04 = (await get('/vehicles')).find(v => v.id === 4);
  check(v04.status === 'maintenance', '不合格车辆自动转维保');
  const passCheck = (await post('/safety-checks', {
    vehicleId: 1, driverId: 1,
    items: { brake: true, lights: true, doors: true, wheelchair_lock: true, extinguisher: true, battery: true },
  })).data;
  check(passCheck.passed, 'V01 安检合格');

  console.log('\n=== 7. 派班多重阻断 ===');
  await expectFail('/trips', { vehicleId: 6, driverId: 3, originStationId: 1, destStationId: 4 },
    ['充电', '休息'], 'V06充电+低电量 / 李海燕超时未休 → 多重阻断');
  await expectFail('/trips', { vehicleId: 4, driverId: 1, originStationId: 1, destStationId: 4 },
    ['维保'], '维保车辆派班被阻断');
  // 合法派班 V01 王建国
  const tripV01 = (await post('/trips', { vehicleId: 1, driverId: 1, originStationId: 1, destStationId: 4 })).data.trip;
  check(!!tripV01.id && tripV01.status === 'boarding', '合法派班 V01 成功');
  // 在东门连续检 11 张单人票（14 座 - 留座 3 = 可售 11）
  let boardedCount = 0;
  for (let i = 0; i < 11; i++) {
    const tk = await buy({ visitorName: `留座测试${i}`, originStationId: 1, destStationId: 3 });
    await enqueue(1, tk.code);
    const rr = await boardNext(1, tripV01.id);
    if (rr.ok) boardedCount++;
  }
  check(boardedCount === 11, '留座规则下东门恰好可售 11 张');
  const lockTicket = await buy({ visitorName: '被留座挡住', originStationId: 1, destStationId: 3 });
  await enqueue(1, lockTicket.code);
  b = await boardNext(1, tripV01.id);
  check(!b.ok && b.downstreamReserve === 3, '第 12 张触发留座锁定，downstreamReserve=3');
  const board1Trip = (await get('/stations/1/board')).trips.find(t => t.id === tripV01.id);
  check(board1Trip.sellable === 0 && board1Trip.downstreamReserve === 3, '班车卡展示可售 0 / 留座 3');

  console.log('\n=== 8. 反方向拦截与强制放行 ===');
  const back = await buy({ visitorName: '坐反方向', originStationId: 2, destStationId: 1 });
  await enqueue(2, back.code);
  const backEntry = (await get('/stations/2/board')).queue.find(q => q.ticketId === back.id);
  await expectFail(`/queue/${backEntry.id}/board`, { tripId: tripV01.id }, ['方向'], '反方向检票被拦截');
  r = await post(`/queue/${backEntry.id}/board`, { tripId: tripV01.id, force: true });
  check(r.ok, '强制放行成功并通知调度接应');

  console.log('\n=== 9. 调度临时增派空车接驳 ===');
  await post('/drivers/4/duty', { action: 'on' }); // 赵师傅签到
  r = await post(`/skip-records/${skipId}/dispatch-extra-vehicle`, { vehicleId: 5, driverId: 4, note: '空车直放百花园' });
  check(r.ok && !!r.data.reliefTripCode, '增派空车成功，生成接驳班次');
  check(r.data.affectedGroups.every(g => g.queueStatus === 'waiting'), '滞留游客自动转回排队等待接驳');
  const reliefId = r.data.reliefTripId;
  const board2after = await get('/stations/2/board');
  check(board2after.trips.some(t => t.id === reliefId && t.status === 'boarding'), '接驳车出现在百花园看板');
  // 非法增派：在运车辆 V01
  await expectFail(`/skip-records/${skipId}/dispatch-extra-vehicle`, { vehicleId: 1, driverId: 1 }, ['待命'], '在运车辆不能被增派');

  console.log('\n=== 10. 游客投诉 → 客服用同一记录办结 ===');
  r = await post(`/skip-records/${skipId}/complaint`, { ticketId: vA.id, visitorName: '被跳甲等', note: '等待太久要求补偿' });
  check(r.data.complaintStatus === 'open', '游客发起跳站投诉');
  let wb = await get('/service/workbench');
  check(wb.counts.skipComplaint >= 1 && wb.skipComplaints.some(s => s.id === skipId), '客服工作台出现同一跳站记录投诉');
  r = await post(`/skip-records/${skipId}/dispatch-review`, { reviewerName: '钱主管', note: '处置到位' });
  check(r.data.status === 'dispatch_reviewed' && !r.data.closedAt, '投诉未办结前主管复核不自动闭环');
  r = await post(`/skip-records/${skipId}/complaint/handle`, {
    resolution: 'compensation', note: '发放矿泉水与8折补偿券', agentName: '客服小李',
  });
  check(r.data.complaintStatus === 'closed' && r.data.status === 'closed', '客服办结投诉后记录闭环');
  const detailAAfter = await get(`/tickets/code/${vA.code}`);
  const sr2 = detailAAfter.skipRecords.find(s => s.id === skipId);
  check(sr2.complaintNote.includes('8折'), '游客车票页看到客服回复');

  console.log('\n=== 11. 车辆故障 ===');
  r = await post('/vehicles/3/fault', { detail: '电池过热报警' });
  check(r.ok, '故障上报成功');
  const v03 = (await get('/vehicles')).find(v => v.id === 3);
  check(v03.status === 'breakdown', 'V03 转故障停驶');

  console.log('\n=== 12. 退票核准 → 财务出账 ===');
  const rf1 = await buy({ visitorName: '退票甲', originStationId: 1, destStationId: 3 });
  let refund = (await post(`/tickets/${rf1.id}/refund`, { reason: '调度延误久等', faultTag: 'schedule' })).data.refund;
  check(!!refund.id, '生成退票单');
  r = await post(`/refunds/${refund.id}/approve`, { note: '调度责任，同意全额' });
  check(r.data.status === 'approved', '客服核准退票');
  r = await post(`/refunds/${refund.id}/pay`, { note: '原路退回' });
  check(r.data.status === 'paid', '财务出账完成');
  const paidList = await get('/tickets/refunds?status=paid');
  check(paidList.some(x => x.id === refund.id), '已付款列表可查');

  console.log('\n=== 13. 退票争议升级 → 客服主管终局裁决 ===');
  const rf2 = await buy({ visitorName: '退票乙', originStationId: 1, destStationId: 3 });
  refund = (await post(`/tickets/${rf2.id}/refund`, { reason: '游客想退', faultTag: 'visitor' })).data.refund;
  r = await post(`/refunds/${refund.id}/escalate`, { note: '责任有争议' });
  check(r.data.status === 'escalated', '客服升级主管');
  r = await post(`/refunds/${refund.id}/supervisor-decide`, { approve: false, note: '维持驳回' });
  check(r.data.status === 'rejected', '主管终局裁决驳回');

  console.log('\n=== 14. 交班延误 ===');
  // 先把接驳车与 V01 班次完班，释放人车
  check((await post(`/trips/${reliefId}/complete`)).ok !== false, '接驳车完班');
  check((await post(`/trips/${tripV01.id}/complete`)).ok !== false, 'V01 班次完班');
  r = await post('/drivers/4/handover-delay', { minutes: 25, reason: '接班司机未到' });
  check(r.data.ok && Array.isArray(r.data.delayedTrips), '交班延误上报成功');
  await expectFail('/trips', { vehicleId: 1, driverId: 4, originStationId: 1, destStationId: 4 },
    ['交班'], '交班延误司机不可派班');

  console.log('\n=== 15. 暴雨橙色：派班阻断 + 一键停运 ===');
  await post('/weather', { condition: '暴雨', tempC: 24, warning: '暴雨橙色预警', warningLevel: 3, rainfallMmH: 40 });
  await post('/drivers/4/duty', { action: 'on' }); // 解除交班态以便验证纯天气阻断
  await expectFail('/trips', { vehicleId: 1, driverId: 1, originStationId: 1, destStationId: 4 },
    ['暂停发车'], '橙色预警下派班被阻断');
  const suspended = (await post('/dispatch/storm-suspend', { reason: '暴雨橙色，降雨量40mm/h' })).data;
  check(suspended.suspendedTrips.some(c => c === 'TR20261001-001'), '在运班 TR-001 被停运');
  check((await post('/dispatch/resume')).data.ok, '预警解除恢复接口可用');

  console.log('\n=== 16. 团队包车：座位/轮椅校验 ===');
  const charter = (await post('/charters', {
    teamName: '山海研学团', contact: '王老师', phone: '13800000000',
    peopleCount: 18, needWheelchair: 2, startStationId: 1,
    routePlan: '东门→山顶→玻璃栈道', useDate: '2026-10-02',
  })).data;
  await expectFail(`/charters/${charter.id}/assign`, { vehicleId: 1, driverId: 1 }, ['14'], '小车 14 座配 18 人被拒');
  r = await post(`/charters/${charter.id}/assign`, { vehicleId: 5, driverId: 1 });
  check(r.data.status === 'confirmed', 'V05（20座/3轮椅）配车成功并预留');
  await post(`/charters/${charter.id}/status`, { status: 'ongoing' });
  r = await post(`/charters/${charter.id}/status`, { status: 'completed' });
  check(r.data.status === 'completed', '包车完单释放车辆');

  console.log('\n=== 17. 广播 / 限流 ===');
  await post('/broadcasts', { stationId: 2, content: '百花园跳站游客请等候增派空车' });
  const bcs = await get('/broadcasts?stationId=2');
  check(bcs.some(x => x.content.includes('增派空车')), '站点广播可查');
  await req('PATCH', '/stations/2', { flowLimitPerHour: 260 });
  check((await get('/stations/2/board')).flowLimitPerHour === 260, '景点限流设置生效');

  console.log('\n=== 18. 车票时间线 / 围栏 / 复盘报表 ===');
  const timeline = await get(`/tickets/code/${back.code}`);
  check(timeline.incidents.some(i => i.type === 'wrong_direction'), '强制放行票时间线含误乘事件');
  const geo = await get('/geofence-events');
  check(geo.length > 0, '电子围栏事件已记录');
  const report = await get('/ops/report');
  check(!!report.kpi && Array.isArray(report.stationWait), '复盘报表返回 KPI 与站点等待');
  check(report.stationWait.some(s => s.skippedGroups >= 1), '报表统计被跳组数');
  check(report.complaintReasons.some(c => c.type === 'skip_station' && c.count >= 2), '投诉原因分布含满载跳站≥2');
  check(report.refundByFault.some(f => f.fault === 'schedule'), '退票成本按调度责任归类');

  console.log(`\n────────────────────────\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
  console.log('ALL_SCENARIOS_PASSED');
}

main().catch(e => { console.error('脚本异常：', e); process.exit(1); });
