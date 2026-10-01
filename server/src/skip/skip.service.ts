import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  SkipRecord, Trip, Vehicle, Driver, Station, RouteLine, QueueEntry,
  Ticket, Incident, Weather, RoadControl, SafetyCheck, Broadcast,
} from '../entities';
import { IncidentsService } from '../incidents/incidents.service';
import { now, seqCode } from '../common';

const MIN_BATTERY = 20;
const STORM_LEVEL = 3;
const HOP_MINUTES = 3;          // 演示：相邻站行驶约 3 分钟
const VOUCHER_LONG = 1000;      // 等待 ≥20 分钟补偿券 ¥10
const VOUCHER_MEDIUM = 500;     // 等待 ≥10 分钟补偿券 ¥5

@Injectable()
export class SkipService {
  constructor(
    @InjectRepository(SkipRecord) private readonly records: Repository<SkipRecord>,
    @InjectRepository(Trip) private readonly trips: Repository<Trip>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(Station) private readonly stations: Repository<Station>,
    @InjectRepository(RouteLine) private readonly routes: Repository<RouteLine>,
    @InjectRepository(QueueEntry) private readonly queue: Repository<QueueEntry>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Incident) private readonly incidents: Repository<Incident>,
    @InjectRepository(Weather) private readonly weatherRepo: Repository<Weather>,
    @InjectRepository(RoadControl) private readonly controls: Repository<RoadControl>,
    @InjectRepository(SafetyCheck) private readonly checks: Repository<SafetyCheck>,
    @InjectRepository(Broadcast) private readonly broadcasts: Repository<Broadcast>,
    private readonly incidentSvc: IncidentsService,
  ) {}

  /* ================= 自动登记（车辆到站满载触发） ================= */

  async recordSkip(trip: Trip, vehicle: Vehicle, station: Station, waiting: QueueEntry[]): Promise<SkipRecord> {
    const route = await this.routes.findOne({ where: { id: trip.routeId } });
    const people = waiting.reduce((a, e) => a + e.partySize, 0);

    // 班次记录被跳过的站点
    const skipped = trip.skippedStations || [];
    if (!skipped.includes(station.id)) skipped.push(station.id);
    trip.skippedStations = skipped;
    await this.trips.save(trip);

    // 站台游客转回跳站等待（下一班到站自动/站务手动转回排队）
    for (const e of waiting) e.status = 'skipped';
    await this.queue.save(waiting);

    const eta = await this.predictNext(trip, vehicle, station, route!);
    const voucher = eta.minutes >= 20 ? VOUCHER_LONG : eta.minutes >= 10 ? VOUCHER_MEDIUM : 0;
    const compensationNote = voucher > 0
      ? `下一班预计 ${eta.minutes} 分钟后到站，等待较久：凭本记录向站务领取等待补偿券 ¥${(voucher / 100).toFixed(2)}（当日乘车可用），站台提供遮阳/饮水等候区`
      : `下一班预计 ${eta.minutes} 分钟内到站，请在站台等候区等待；如实际等待超过 15 分钟，可向站务领取 ¥10.00 等待补偿券`;

    const routeStations = await this.stations.find({
      where: { routeId: route!.id }, order: { seq: 'ASC' },
    });
    const here = routeStations.find(s => s.id === station.id);
    const neighbors = routeStations
      .filter(s => Math.abs(s.seq - (here?.seq || 0)) === 1)
      .map(s => s.name);
    const transferNote =
      `① 原地等候下一班，凭本记录优先安排（优先组规则不变）；`
      + (neighbors.length ? `② 可步行约 8 分钟至相邻站「${neighbors.join(' / ')}」分流乘车；` : '')
      + `③ 老人/轮椅/带婴儿车游客请联系站台工作人员安排无障碍接驳；④ 不愿继续等待可在游客端申请无责退票`;

    const affectedTicketIds = waiting.map(e => e.ticketId);
    const record = await this.records.save(this.records.create({
      code: seqCode('SK'),
      stationId: station.id,
      tripId: trip.id,
      vehicleId: vehicle.id,
      routeId: trip.routeId,
      reason: vehicle.wheelchairSeats - trip.wheelchairHeld <= 0 && vehicle.capacity - trip.seatsSold <= 0
        ? 'wheelchair_full' : 'vehicle_full',
      onboardCount: trip.seatsSold,
      capacity: vehicle.capacity,
      wheelchairHeld: trip.wheelchairHeld,
      platformGroups: waiting.length,
      platformPeople: people,
      nextTripId: eta.tripId,
      nextEtaAt: eta.at,
      nextEtaMinutes: eta.minutes,
      nextVehicleCode: eta.vehicleCode,
      compensationNote,
      compensationVoucher: voucher,
      transferNote,
      affectedTicketIds,
      dispatchAction: 'pending',
      waitPolicy: '持跳站记录游客在原站台优先等候下一班，优先组顺序不变；站务每 5 分钟播报一次下一班位置与预计到站；实际等待超 15 分钟启动补偿券发放，老人/轮椅游客专人引导',
      status: 'recorded',
      createdAt: now(),
    }));

    await this.incidentSvc.create({
      type: 'skip_station', severity: 'critical',
      title: `满载跳站：${trip.code} 越过 ${station.name}`,
      detail: `车内 ${trip.seatsSold}/${vehicle.capacity} 人已满载，站台 ${people} 人（${waiting.length} 组）未能上车；`
        + `下一班${eta.vehicleCode}预计 ${eta.minutes} 分钟后到站；已生成等待补偿与换乘建议，等待站点负责人确认、调度处置与主管复核`,
      tripId: trip.id, stationId: station.id, vehicleId: vehicle.id,
      skipRecordId: record.id,
      raisedByRole: 'system', ownerRole: 'staff',
      firstNote: `电子围栏识别到站、座位余量为 0，自动登记跳站解释记录 ${record.code}：车内 ${trip.seatsSold} 人、下一班约 ${eta.minutes} 分钟；站台 ${waiting.length} 组游客转跳站等待`,
    });

    // 站台广播：游客在站台即可获知下一班与补偿/换乘
    await this.broadcasts.save(this.broadcasts.create({
      stationId: station.id,
      content: `本班车满载跳站，车内 ${trip.seatsSold}/${vehicle.capacity} 人未能上客；下一班${eta.vehicleCode}预计 ${eta.minutes} 分钟后到站。${compensationNote} ${transferNote}`,
      spokenByRole: 'system',
      createdAt: now(),
    }));

    record.incidentId = (await this.incidents.findOne({ where: { skipRecordId: record.id } }))?.id || null;
    return this.records.save(record);
  }

  /** 预测同方向下一班到本站时间：在途/计划班按相邻站 3 分钟估算，否则按线路发车间隔 */
  private async predictNext(trip: Trip, vehicle: Vehicle, station: Station, route: RouteLine) {
    const candidates = (await this.trips.find({
      where: { routeId: route.id, status: In(['scheduled', 'boarding', 'running']) },
    })).filter(t => t.id !== trip.id
      && (t.direction === trip.direction || t.direction === 'loop' || trip.direction === 'loop'));
    const vehRows = await this.vehicles.find({
      where: { id: In(candidates.map(t => t.vehicleId)) },
    });
    const vMap = new Map(vehRows.map(v => [v.id, v]));
    const routeStations = await this.stations.find({
      where: { routeId: route.id }, order: { seq: 'ASC' },
    });
    const seqOf = new Map(routeStations.map(s => [s.id, s.seq]));

    let best: { minutes: number; tripId: number; vehicleCode: string } | null = null;
    for (const t of candidates) {
      const v = vMap.get(t.vehicleId);
      const curId = v?.currentStationId || t.originStationId;
      let minutes: number;
      if (curId === station.id) {
        minutes = HOP_MINUTES;
      } else {
        const hops = Math.abs((seqOf.get(curId) || 0) - (seqOf.get(station.id) || 0));
        minutes = Math.max(HOP_MINUTES, hops * HOP_MINUTES) + (t.status === 'scheduled' ? route.intervalMinutes : 0);
      }
      if (!best || minutes < best.minutes) {
        best = { minutes, tripId: t.id, vehicleCode: v?.code || `班次 ${t.code}` };
      }
    }
    if (best) return { ...best, at: new Date(Date.now() + best.minutes * 60000).toISOString() };
    return {
      minutes: route.intervalMinutes,
      tripId: null,
      vehicleCode: `按${route.intervalMinutes}分钟间隔的下一班（待调度派车）`,
      at: new Date(Date.now() + route.intervalMinutes * 60000).toISOString(),
    };
  }

  /* ================= 查询（四端共用） ================= */

  async list(filter: { stationId?: number; status?: string; open?: boolean } = {}) {
    const rows = await this.records.find({ order: { id: 'DESC' }, take: 100 });
    const [stations, trips, vehicles, extraTrips] = await Promise.all([
      this.stations.find(),
      this.trips.find(),
      this.vehicles.find(),
      this.trips.find(),
    ]);
    const sMap = new Map(stations.map(s => [s.id, s]));
    const tMap = new Map(trips.map(t => [t.id, t]));
    const vMap = new Map(vehicles.map(v => [v.id, v]));
    let out = rows.map(r => ({
      ...r,
      stationName: sMap.get(r.stationId)?.name || `#${r.stationId}`,
      tripCode: tMap.get(r.tripId)?.code || '',
      vehicleCode: vMap.get(r.vehicleId)?.code || '',
      extraTripCode: r.extraTripId ? (extraTrips.find(t => t.id === r.extraTripId)?.code || '') : '',
    }));
    if (filter.stationId) out = out.filter(r => r.stationId === Number(filter.stationId));
    if (filter.status) out = out.filter(r => r.status === filter.status);
    if (filter.open) out = out.filter(r => r.status !== 'closed');
    return out;
  }

  async get(id: number) {
    const r = await this.records.findOne({ where: { id } });
    if (!r) throw new NotFoundException('跳站记录不存在');
    const tickets = await this.tickets.find({
      where: { id: In(r.affectedTicketIds || []) },
    });
    const list = await this.list({});
    return { ...(list.find(x => x.id === id) || r), affectedTickets: tickets };
  }

  /** 游客端：与某张票相关的跳站解释（等待补偿 / 换乘建议） */
  async forTicket(ticketId: number) {
    const rows = await this.records.find({ order: { id: 'DESC' }, take: 50 });
    const stations = await this.stations.find();
    const sMap = new Map(stations.map(s => [s.id, s]));
    return rows
      .filter(r => (r.affectedTicketIds || []).includes(ticketId))
      .map(r => ({ ...r, stationName: sMap.get(r.stationId)?.name || `#${r.stationId}` }));
  }

  /* ================= 站点端：同步等候策略 + 负责人确认 ================= */

  async syncWaitPolicy(id: number, body: { waitPolicy: string; leaderName?: string }) {
    const r = await this.require(id);
    if (!body.waitPolicy?.trim()) throw new BadRequestException('请填写等候策略');
    r.waitPolicy = body.waitPolicy.trim();
    await this.records.save(r);
    await this.incidentSvc.addNote(r.incidentId!, 'staff',
      `站点端同步等候策略${body.leaderName ? `（${body.leaderName}）` : ''}：${r.waitPolicy}`);
    return r;
  }

  async confirm(id: number, body: { leaderName: string; note?: string; waitPolicy?: string }) {
    const r = await this.require(id);
    if (r.confirmedAt) throw new BadRequestException('站点负责人已确认，请勿重复确认');
    if (!body.leaderName?.trim()) throw new BadRequestException('请填写站点负责人姓名');
    r.confirmedBy = body.leaderName.trim();
    r.confirmedAt = now();
    r.stationLeaderNote = body.note || '';
    if (body.waitPolicy?.trim()) r.waitPolicy = body.waitPolicy.trim();
    r.status = 'confirmed';
    await this.records.save(r);
    const inc = await this.incidents.findOne({ where: { id: r.incidentId! } });
    if (inc) {
      inc.ownerRole = 'dispatch';
      await this.incidents.save(inc);
    }
    await this.incidentSvc.addNote(r.incidentId!, 'staff',
      `站点负责人 ${r.confirmedBy} 确认跳站记录：等候策略已同步站务执行${body.note ? `；${body.note}` : ''}；流转调度中心处置（增派空车/调整离站规则）`);
    return r;
  }

  /** 站务把跳站等待的游客手动转回下一班排队（下一班到站也会自动转回） */
  async restoreQueue(id: number) {
    const r = await this.require(id);
    const entries = await this.queue.find({
      where: {
        stationId: r.stationId,
        ticketId: In(r.affectedTicketIds || []),
        status: 'skipped' as any,
      },
    });
    for (const e of entries) { e.status = 'waiting'; await this.queue.save(e); }
    await this.incidentSvc.addNote(r.incidentId!, 'staff',
      `站务将 ${entries.length} 组跳站等待游客转回排队，优先搭乘下一班/增派空车`);
    return { restored: entries.length };
  }

  /* ================= 调度端：增派空车 / 调整离站规则 / 主管复核 ================= */

  async dispatchExtra(id: number, body: { vehicleId: number; driverId: number; note?: string }) {
    const r = await this.require(id);
    const [station, vehicle, driver, route] = await Promise.all([
      this.stations.findOne({ where: { id: r.stationId } }),
      this.vehicles.findOne({ where: { id: body.vehicleId } }),
      this.drivers.findOne({ where: { id: body.driverId } }),
      this.routes.findOne({ where: { id: r.routeId } }),
    ]);
    if (!vehicle) throw new NotFoundException('车辆不存在');
    if (!driver) throw new NotFoundException('司机不存在');

    const routeStations = await this.stations.find({
      where: { routeId: r.routeId }, order: { seq: 'ASC' },
    });
    // 增派空车沿被跳班次同方向，终点站取该方向线路端点
    const skippedTrip = await this.trips.findOne({ where: { id: r.tripId } });
    const backward = skippedTrip?.direction === 'backward';
    const destStation = backward
      ? routeStations.reduce((a, b) => (b.seq < a.seq ? b : a))
      : routeStations.reduce((a, b) => (b.seq > a.seq ? b : a));

    const blockers = await this.dispatchBlockers(vehicle, driver, station!, destStation);
    if (blockers.length) throw new BadRequestException(blockers.join('；'));

    const trip = await this.trips.save(this.trips.create({
      code: seqCode('TR'),
      routeId: r.routeId,
      vehicleId: vehicle.id,
      driverId: driver.id,
      direction: skippedTrip?.direction || 'forward',
      status: 'running',                 // 空车先驶向跳站站点，司机到站围栏触发上客
      originStationId: station!.id,
      destStationId: destStation.id,
      departAt: now(),
      seatsTotal: vehicle.capacity,
      seatsSold: 0,
      skippedStations: [],
    }));
    vehicle.status = 'running';
    vehicle.currentTripId = trip.id;
    await this.vehicles.save(vehicle);
    driver.status = 'driving';
    driver.currentVehicleId = vehicle.id;
    await this.drivers.save(driver);

    r.extraTripId = trip.id;
    r.dispatchAction = r.dispatchAction === 'rule_adjusted' ? 'both' : 'extra_dispatched';
    r.dispatchNote = [r.dispatchNote, `临时增派空车 ${vehicle.code}/${driver.name}（${trip.code}）${body.note ? `：${body.note}` : ''}`]
      .filter(Boolean).join('｜');
    await this.records.save(r);
    await this.incidentSvc.addNote(r.incidentId!, 'dispatch',
      `调度针对跳站记录临时增派空车 ${vehicle.code}（${trip.code}，${route?.intervalMinutes} 分钟内可达 ${station?.name}），空车到站后跳站等待游客优先上客`);
    return { trip };
  }

  private async dispatchBlockers(v: Vehicle, d: Driver, origin: Station, dest: Station) {
    const blockers: string[] = [];
    if (['maintenance', 'breakdown'].includes(v.status)) blockers.push(`车辆 ${v.code} 状态为${v.status === 'breakdown' ? '故障' : '维保'}，不可派车`);
    if (v.status === 'running') blockers.push(`车辆 ${v.code} 正在在运班次上，不能作为空车增派`);
    if (v.status === 'charging') blockers.push(`车辆 ${v.code} 正在充电`);
    if (v.reservedForCharter) blockers.push(`车辆 ${v.code} 已被包车预留`);
    if (v.battery < MIN_BATTERY) blockers.push(`车辆电量 ${v.battery}% 低于 ${MIN_BATTERY}%`);
    if (d.status === 'off') blockers.push(`司机 ${d.name} 未签到上岗`);
    if (d.status === 'driving') blockers.push(`司机 ${d.name} 正在驾驶在运班次，不能再派空车`);
    if (d.status === 'rest') blockers.push(`司机 ${d.name} 正在强制休息`);
    if (d.status === 'handover') blockers.push(`司机 ${d.name} 处于交班延误中`);
    if (d.restRequired) blockers.push(`司机 ${d.name} 连续驾驶超时未休息`);
    if (d.workMinutesToday >= d.maxWorkMinutes) blockers.push('司机今日工时已达上限');

    const rows = await this.checks.find({ where: { vehicleId: v.id, driverId: d.id }, order: { id: 'DESC' }, take: 1 });
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const check = rows[0];
    if (!check || !check.passed || new Date(check.checkedAt) < start) {
      blockers.push('司机今日对该车的发车前安全检查未完成或未通过');
    }
    const [weather] = await this.weatherRepo.find({ order: { id: 'DESC' }, take: 1 });
    if (weather && weather.warningLevel >= STORM_LEVEL) blockers.push(`${weather.warning}，按预案暂停派车`);
    const closed = await this.controls.find({ where: { status: 'active' } });
    if (closed.some(c => /封闭/.test(c.reason) && !/未封闭|没有封闭|暂无封闭/.test(c.reason)
      && (!c.stationId || c.stationId === origin.id || c.stationId === dest.id))) {
      blockers.push('前往跳站站点方向有道路封闭管制');
    }
    return blockers;
  }

  /** 调整车辆不满载离站规则：满载可跳站 / 为本站预留座位（途经车不满载离站保留运力） */
  async adjustRule(id: number, body: { rule: Station['dispatchRule']; reserveSeats?: number; note?: string }) {
    const r = await this.require(id);
    const station = await this.stations.findOne({ where: { id: r.stationId } });
    if (!station) throw new NotFoundException('站点不存在');
    const rule = body.rule === 'reserve_seats' ? 'reserve_seats' : 'full_load_skip';
    station.dispatchRule = rule;
    station.reserveSeats = rule === 'reserve_seats' ? Math.max(1, Number(body.reserveSeats) || 2) : 0;
    station.dispatchRuleUpdatedAt = now();
    await this.stations.save(station);

    r.dispatchAction = r.extraTripId ? 'both' : 'rule_adjusted';
    const text = rule === 'reserve_seats'
      ? `调度调整「${station.name}」下一轮车辆规则：途经本站车辆须预留 ${station.reserveSeats} 座（不满载离站），为本站保留运力`
      : `调度将「${station.name}」恢复为满载可跳站默认规则`;
    r.dispatchNote = [r.dispatchNote, `${text}${body.note ? `：${body.note}` : ''}`].filter(Boolean).join('｜');
    await this.records.save(r);
    await this.incidentSvc.addNote(r.incidentId!, 'dispatch', text);
    return { station };
  }

  async review(id: number, body: { reviewer: string; note: string }) {
    const r = await this.require(id);
    if (!r.confirmedAt) throw new BadRequestException('请先由站点负责人确认后，调度主管再复核');
    if (r.reviewedAt) throw new BadRequestException('调度主管已复核');
    if (!body.reviewer?.trim()) throw new BadRequestException('请填写调度主管姓名');
    r.reviewedBy = body.reviewer.trim();
    r.reviewedAt = now();
    r.reviewNote = body.note || '';
    const actionText: Record<string, string> = {
      none: '未采取调度动作', pending: '待处置',
      extra_dispatched: '已临时增派空车', rule_adjusted: '已调整不满载离站规则',
      both: '已增派空车并调整离站规则',
    };
    const summary = `调度主管 ${r.reviewedBy} 复核完成：${actionText[r.dispatchAction]}；下一班 ${r.nextVehicleCode} 约 ${r.nextEtaMinutes} 分钟`;
    const unresolvedComplaint = r.complaintCount > 0 && !r.complaintSummary.includes('【客服已处理】');
    if (!unresolvedComplaint) {
      r.status = 'closed';
    } else {
      r.status = 'reviewed';
    }
    await this.records.save(r);

    const inc = await this.incidents.findOne({ where: { id: r.incidentId! } });
    if (inc) {
      if (r.complaintCount === 0) {
        inc.status = 'resolved';
        inc.resolution = summary;
        await this.incidents.save(inc);
      }
      await this.incidentSvc.addNote(inc.id, 'dispatch',
        `${summary}${body.note ? `；${body.note}` : ''}`);
    }
    return r;
  }

  /* ================= 客服端：同一条跳站记录处理投诉 ================= */

  async addComplaint(id: number, body: { visitorName: string; content: string }) {
    const r = await this.require(id);
    if (!body.content?.trim()) throw new BadRequestException('请填写投诉内容');
    r.complaintCount += 1;
    const line = `［${body.visitorName || '游客'}］${body.content.trim()}`;
    r.complaintSummary = [r.complaintSummary, line].filter(Boolean).join('\n');
    if (r.reviewedAt) r.status = 'reviewed';   // 已复核闭环后再收到投诉：回到投诉处理中
    await this.records.save(r);
    const inc = await this.incidents.findOne({ where: { id: r.incidentId! } });
    if (inc) {
      inc.status = 'processing';
      inc.ownerRole = 'service';
      await this.incidents.save(inc);
    }
    await this.incidentSvc.addNote(r.incidentId!, 'visitor',
      `游客就跳站记录 ${r.code} 发起投诉：${line}（客服基于同一记录处理）`);
    return r;
  }

  async resolveComplaint(id: number, body: { note: string }) {
    const r = await this.require(id);
    if (r.complaintCount === 0) throw new BadRequestException('该记录暂无游客投诉');
    if (!body.note?.trim()) throw new BadRequestException('请填写客服处理说明');
    r.complaintSummary = `${r.complaintSummary}\n【客服已处理】${body.note.trim()}`;
    const done = r.reviewedAt != null;
    if (done) r.status = 'closed';
    await this.records.save(r);
    const inc = await this.incidents.findOne({ where: { id: r.incidentId! } });
    if (inc) {
      await this.incidentSvc.addNote(inc.id, 'service',
        `客服基于跳站记录处理投诉：${body.note}${done ? '；主管已复核，事件闭环' : '；等待调度主管复核'}`);
      if (done) {
        inc.status = 'closed';
        inc.resolution = `跳站投诉已处理：${body.note}`;
        await this.incidents.save(inc);
      } else {
        inc.ownerRole = 'dispatch';
        inc.status = 'open';
        await this.incidents.save(inc);
      }
    }
    return r;
  }

  private async require(id: number): Promise<SkipRecord> {
    const r = await this.records.findOne({ where: { id } });
    if (!r) throw new NotFoundException('跳站记录不存在');
    return r;
  }

  /* ================= 线路预留座位规则（检票时强制为下游预留站留座） ================= */

  /** 返回本班次沿行进方向、当前站之后所有 reserve_seats 站点中最大的预留座位数 */
  async reserveRequiredAhead(trip: Trip, currentStationId: number): Promise<number> {
    const stations = await this.stations.find({ where: { routeId: trip.routeId } });
    const cur = stations.find(s => s.id === currentStationId);
    if (!cur) return 0;
    return stations
      .filter(s => s.dispatchRule === 'reserve_seats'
        && (trip.direction === 'backward' ? s.seq < cur.seq : s.seq > cur.seq))
      .reduce((m, s) => Math.max(m, s.reserveSeats || 0), 0);
  }
}
