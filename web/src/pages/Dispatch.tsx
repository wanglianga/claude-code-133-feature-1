import { useState } from 'react';
import {
  Card, Button, Tag, Space, Table, Select, Alert, Row, Col, Statistic, Modal,
  Input, InputNumber, message, Tabs, Badge, Popconfirm, Typography,
} from 'antd';
import {
  CloudServerOutlined, ThunderboltOutlined, WarningOutlined, CarOutlined,
} from '@ant-design/icons';
import { api, TRIP_STATUS } from '../api';
import { useApi } from '../hooks';
import { SkipRecordTimeline, complaintTag, skipStatusTag } from '../components/SkipShared';

export default function DispatchPage() {
  const [tick, setTick] = useState(0);
  const { data: dash, loading } = useApi<any>(`/dispatch/dashboard?t=${tick}`, [tick]);
  const { data: geo } = useApi<any[]>('/geofence-events');
  const refresh = () => setTick(t => t + 1);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Button onClick={refresh}>刷新看板</Button>
        {dash?.weather?.warningLevel >= 3 ? (
          <Popconfirm title="确认预警解除、恢复运营？" onConfirm={async () => {
            await api.post('/dispatch/resume', {});
            message.success('可重新派班');
          }}>
            <Button type="primary" ghost>运营恢复（仅解除派班限制，请同步更新天气）</Button>
          </Popconfirm>
        ) : null}
      </Space>

      <Row gutter={12}>
        <Col xs={12} md={6}>
          <Card><Statistic title="在运/上客班车"
            value={dash?.trips?.filter((t: any) => ['boarding', 'running'].includes(t.status)).length || 0} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="拥堵站点"
            value={dash?.stations?.filter((s: any) => s.congestion === 'overloaded').length || 0}
            valueStyle={{ color: '#cf1322' }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="故障/维保车"
            value={dash?.vehicles?.filter((v: any) => ['breakdown', 'maintenance'].includes(v.status)).length || 0}
            valueStyle={{ color: '#d46b08' }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="待处理包车"
            value={dash?.charters?.filter((c: any) => c.status === 'pending').length || 0} /></Card>
        </Col>
      </Row>

      {dash?.suggestions?.length > 0 && (
        <Card title={<Space><ThunderboltOutlined />智能调度建议（客流 · 电量 · 工时 · 管制 · 天气）</Space>}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {dash.suggestions.map((s: any, i: number) => (
              <Alert key={i} showIcon type={s.level === 'critical' ? 'error' : 'warning'}
                icon={<WarningOutlined />} message={s.text} />
            ))}
          </Space>
        </Card>
      )}

      <Tabs
        items={[
          { key: 'board', label: '站点与车辆', children: <BoardTab dash={dash} loading={loading} geo={geo} refresh={refresh} /> },
          { key: 'skip',
            label: <Badge count={dash?.skipRecords?.filter((r: any) => !r.dispatchReviewedAt).length || 0}
              offset={[10, -2]} size="small">满载跳站处置</Badge>,
            children: <SkipTab dash={dash} refresh={refresh} /> },
          { key: 'dispatch', label: '派班发车', children: <DispatchTab dash={dash} refresh={refresh} /> },
          { key: 'charter', label: '团队包车', children: <CharterTab dash={dash} refresh={refresh} /> },
          { key: 'weather', label: '天气与道路管制', children: <WeatherTab dash={dash} refresh={refresh} /> },
        ]}
      />
    </Space>
  );
}

function BoardTab({ dash, loading, geo, refresh }: any) {
  const stations = dash?.stations || [];
  const vehicles = dash?.vehicles || [];
  const drivers = dash?.drivers || [];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="站点客流与拥堵（热门站超站台容量自动预警并推送加车建议）">
        <Table rowKey="id" size="small" loading={loading} pagination={false} dataSource={stations}
          columns={[
            { title: '站点', key: 'n', render: (_: any, r: any) =>
              <Space>{r.name}{r.isHot && <Tag color="red">热门</Tag>}</Space> },
            { title: '线路', key: 'rn' },
            { title: '容量', dataIndex: 'platformCapacity', width: 80 },
            { title: '限流(人/时)', dataIndex: 'flowLimitPerHour', width: 100,
              render: (n: number) => n || '—' },
            {
              title: '排队/拥堵', key: 'q',
              render: (_: any, r: any) => (
                <Space>
                  <b>{r.waitingPeople}</b> 人
                  <div className="bar-wrap" style={{ width: 110 }}>
                    <div className="bar-track">
                      <div className={`bar-fill ${r.congestion === 'overloaded' ? 'red' : r.congestion === 'busy' ? 'gold' : ''}`}
                        style={{ width: `${Math.min(100, Math.round(r.waitingPeople / r.platformCapacity * 100))}%` }} />
                    </div>
                  </div>
                  {r.congestion === 'overloaded' ? <Tag color="red">过载</Tag>
                    : r.congestion === 'busy' ? <Tag color="orange">繁忙</Tag> : <Tag color="green">畅通</Tag>}
                </Space>
              ),
            },
            { title: '状态', dataIndex: 'status', render: (s: string) =>
              ({ normal: <Tag>正常</Tag>, restricted: <Tag color="orange">限流</Tag>, closed: <Tag color="red">关闭</Tag> } as any)[s] },
          ]} />
      </Card>

      <Card title="车辆实时状态（位置 · 电量 · 轮椅位 · 司机）">
        <Table rowKey="id" size="small" pagination={false} dataSource={vehicles}
          columns={[
            { title: '车号', dataIndex: 'code', width: 80 },
            { title: '车牌', dataIndex: 'plate', width: 110 },
            { title: '座位/轮椅', key: 'cap', render: (_: any, r: any) =>
              <Space>{r.capacity} 座{r.accessible && <Tag color="cyan">♿{r.wheelchairSeats}</Tag>}</Space> },
            {
              title: '电量', dataIndex: 'battery', width: 150,
              render: (n: number) => (
                <div className="bar-wrap">
                  <div className="bar-track" style={{ width: 80 }}>
                    <div className={`bar-fill ${n < 20 ? 'red' : n < 35 ? 'gold' : ''}`} style={{ width: `${n}%` }} />
                  </div>
                  <b style={{ color: n < 20 ? '#cf1322' : undefined }}>{n}%</b>
                </div>
              ),
            },
            { title: '司机', key: 'drv', render: (_: any, r: any) => r.driverName || '—' },
            { title: '当前站/班次', key: 'loc', render: (_: any, r: any) =>
              stations.find((s: any) => s.id === r.currentStationId)?.name || '—',
            },
            {
              title: '状态', dataIndex: 'status',
              render: (s: string) => <Tag color={
                s === 'breakdown' ? 'red' : s === 'maintenance' ? 'orange'
                : s === 'running' ? 'blue' : s === 'charging' ? 'gold' : 'default'}>
                {({ idle: '待命', running: '在运', charging: '充电中', maintenance: '维保', breakdown: '故障' } as any)[s]}
              </Tag>,
            },
            { title: '包车预留', dataIndex: 'reservedForCharter', render: (v: boolean) => v ? <Tag color="purple">已预留</Tag> : '—' },
            {
              title: '操作', key: 'op',
              render: (_: any, r: any) => (
                <Space>
                  {r.status !== 'charging' && r.status !== 'running' &&
                    <Button size="small" onClick={async () => { await api.post(`/vehicles/${r.id}/charge`, { target: 100 }); message.success('已充电至 100%，转待命'); refresh(); }}>充满电</Button>}
                  {['breakdown', 'maintenance'].includes(r.status) &&
                    <Button size="small" type="primary" ghost onClick={async () => { await api.post(`/vehicles/${r.id}/repair`, {}); message.success('维修/复检通过，转待命'); refresh(); }}>修复复检</Button>}
                </Space>
              ),
            },
          ]} />
      </Card>

      <Card title="司机工时与休息">
        <Table rowKey="id" size="small" pagination={false} dataSource={drivers}
          columns={[
            { title: '姓名', dataIndex: 'name' },
            { title: '状态', dataIndex: 'status', render: (s: string) =>
              <Tag color={s === 'rest' ? 'red' : s === 'handover' ? 'orange' : s === 'driving' ? 'blue' : 'default'}>
                {({ off: '未上岗', on_duty: '待命', driving: '驾驶中', rest: '强制休息', handover: '交班延误' } as any)[s]}
              </Tag> },
            { title: '今日工时', key: 'w', render: (_: any, r: any) => `${r.workMinutesToday}/${r.maxWorkMinutes} 分` },
            { title: '连续驾驶', key: 'c', render: (_: any, r: any) =>
              <Space><span>{r.continuousDrivingMinutes} 分</span>{r.restRequired && <Tag color="red">须休息20分</Tag>}</Space> },
            { title: '交班截止', dataIndex: 'handoverDueAt', render: (v: string) => v ? new Date(v).toLocaleTimeString('zh-CN') : '—' },
          ]} />
      </Card>

      <Card title="电子围栏最近事件（车辆进出站自动记录）">
        <Table rowKey="id" size="small" pagination={{ pageSize: 6 }} dataSource={geo || []}
          columns={[
            { title: '时间', dataIndex: 'at', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
            { title: '车辆', key: 'v', render: (_: any, r: any) => vehicles.find((v: any) => v.id === r.vehicleId)?.code || r.vehicleId },
            { title: '站点', key: 's', render: (_: any, r: any) => stations.find((s: any) => s.id === r.stationId)?.name || r.stationId },
            { title: '事件', dataIndex: 'kind', render: (k: string) =>
              <Badge status={k === 'enter' ? 'success' : 'default'} text={k === 'enter' ? '进入围栏（到站）' : '离开围栏（离站）'} /> },
          ]} />
      </Card>
    </Space>
  );
}

function DispatchTab({ dash, refresh }: any) {
  const stations: any[] = dash?.stations || [];
  const [vehicleId, setVehicleId] = useState<number>();
  const [driverId, setDriverId] = useState<number>();
  const [origin, setOrigin] = useState<number>();
  const [dest, setDest] = useState<number>();
  const [departNow, setDepartNow] = useState(true);

  const dispatch = async () => {
    if (!vehicleId || !driverId || !origin || !dest) return message.warning('请选择车辆、司机和起终站');
    try {
      const r = await api.post('/trips', { vehicleId, driverId, originStationId: origin, destStationId: dest, departNow });
      message.success(`派班成功：${r.trip.code}${r.warnings.length ? `；提示：${r.warnings.join('；')}` : ''}`);
      refresh();
    } catch (e: any) { message.error(e.message); }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="安排发车（系统校验：电量≥20% · 安检合格 · 工时/休息/交班 · 道路封闭 · 暴雨预警）">
        <Space wrap align="end">
          <div><div className="muted">车辆</div>
            <Select style={{ width: 240 }} placeholder="选择车辆" value={vehicleId} onChange={setVehicleId}
              options={(dash?.vehicles || []).map((v: any) => ({
                value: v.id,
                label: `${v.code} ${v.capacity}座♿${v.wheelchairSeats} 电量${v.battery}% ${vehicleStatus(v.status)}`,
              }))} /></div>
          <div><div className="muted">司机</div>
            <Select style={{ width: 200 }} placeholder="选择司机" value={driverId} onChange={setDriverId}
              options={(dash?.drivers || []).map((d: any) => ({
                value: d.id,
                label: `${d.name} 工时${d.workMinutesToday}分${d.restRequired ? '(须休息)' : ''}`,
              }))} /></div>
          <div><div className="muted">起点站</div>
            <Select showSearch style={{ width: 180 }} placeholder="起点" value={origin} onChange={setOrigin}
              options={stations.map(s => ({ value: s.id, label: s.name }))} /></div>
          <div><div className="muted">终点站</div>
            <Select showSearch style={{ width: 180 }} placeholder="终点" value={dest} onChange={setDest}
              options={stations.map(s => ({ value: s.id, label: s.name }))} /></div>
          <div><div className="muted">发车方式</div>
            <Select style={{ width: 140 }} value={departNow ? 'now' : 'plan'}
              onChange={v => setDepartNow(v === 'now')}
              options={[{ value: 'now', label: '立即开始上客' }, { value: 'plan', label: '计划班（稍后上客）' }]} /></div>
          <Button type="primary" size="large" onClick={dispatch}>确认派班</Button>
        </Space>
        <Alert style={{ marginTop: 12 }} type="info" showIcon
          message="派班规则：车辆故障/维保/充电/低电量/包车预留、司机未签到/休息中/交班延误/超时未休/达工时上限、安检未过、道路封闭、暴雨橙色及以上预警，任一不满足都将阻断并一次性返回全部原因。" />
      </Card>

      <Card title="最近班次">
        <Table rowKey="id" size="small" pagination={{ pageSize: 8 }} dataSource={dash?.trips || []}
          columns={[
            { title: '班次', dataIndex: 'code' },
            { title: '状态', dataIndex: 'status', render: (s: string) =>
              <Tag color={TRIP_STATUS[s]?.color}>{TRIP_STATUS[s]?.text}</Tag> },
            { title: '区间', key: 'r', render: (_: any, r: any) => `${r.originName} → ${r.destName}` },
            { title: '车/司机', key: 'vd', render: (_: any, r: any) => `${r.vehicleCode} / ${r.driverName}` },
            { title: '上座', key: 's', render: (_: any, r: any) => `${r.seatsTotal - r.seatsLeft}/${r.seatsTotal}` },
            {
              title: '操作', key: 'op',
              render: (_: any, r: any) => (
                <Space direction="vertical" size={2}>
                  {r.status === 'scheduled' &&
                    <Button size="small" type="primary" onClick={async () => { await api.post(`/trips/${r.id}/start-boarding`, {}); message.success('已开始上客'); refresh(); }}>开始上客</Button>}
                  {(r.status === 'delayed') && <Typography.Text type="warning">{r.delayReason}</Typography.Text>}
                  {r.status === 'suspended' && <Typography.Text type="danger">{r.suspendReason}</Typography.Text>}
                </Space>
              ),
            },
          ]} />
      </Card>
    </Space>
  );
}

function CharterTab({ dash, refresh }: any) {
  const [assignFor, setAssignFor] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <Card title="团队包车（座位/轮椅位校验，配车后自动预留车辆）"
      extra={<Button type="primary" onClick={() => setCreateOpen(true)}>代客登记包车申请</Button>}>
      <Table rowKey="id" size="small" pagination={false} dataSource={dash?.charters || []}
        columns={[
          { title: '单号', dataIndex: 'code' },
          { title: '团队', key: 't', render: (_: any, r: any) =>
            <Space direction="vertical" size={0}><b>{r.teamName}</b><span className="muted">{r.contact} {r.phone}</span></Space> },
          { title: '人数/轮椅', key: 'p', render: (_: any, r: any) => `${r.peopleCount} 人 / ♿${r.needWheelchair}` },
          { title: '用车日', dataIndex: 'useDate' },
          { title: '路线', dataIndex: 'routePlan' },
          { title: '费用', dataIndex: 'amount', render: (n: number) => `¥${(n / 100).toFixed(2)}` },
          { title: '状态', dataIndex: 'status', render: (s: string) =>
            <Tag color={s === 'confirmed' ? 'blue' : s === 'completed' ? 'green' : s === 'cancelled' ? 'default' : 'orange'}>
              {({ pending: '待配车', confirmed: '已确认', ongoing: '用车中', completed: '已完成', cancelled: '已取消' } as any)[s]}
            </Tag> },
          { title: '配车', key: 'v', render: (_: any, r: any) =>
            r.vehicleId ? (dash?.vehicles.find((v: any) => v.id === r.vehicleId)?.code || r.vehicleId) : '—' },
          {
            title: '操作', key: 'op',
            render: (_: any, r: any) => (
              <Space>
                {r.status === 'pending' && <Button size="small" type="primary" onClick={() => setAssignFor(r)}>配车</Button>}
                {r.status === 'confirmed' &&
                  <Button size="small" onClick={async () => { await api.post(`/charters/${r.id}/status`, { status: 'ongoing' }); refresh(); }}>开始用车</Button>}
                {r.status === 'ongoing' &&
                  <Button size="small" onClick={async () => { await api.post(`/charters/${r.id}/status`, { status: 'completed' }); message.success('已完单，车辆预留解除'); refresh(); }}>完单释放</Button>}
              </Space>
            ),
          },
        ]} />
      <AssignCharterModal order={assignFor} dash={dash}
        onClose={() => setAssignFor(null)}
        onDone={() => { setAssignFor(null); refresh(); }} />
      <CreateCharterModal open={createOpen} stations={dash?.stations || []}
        onClose={() => setCreateOpen(false)}
        onDone={() => { setCreateOpen(false); refresh(); }} />
    </Card>
  );
}

function CreateCharterModal({ open, stations, onClose, onDone }: any) {
  const [f, setF] = useState<any>({
    teamName: '', contact: '', phone: '', peopleCount: 10, needWheelchair: 0,
    startStationId: stations[0]?.id, routePlan: '', useDate: '',
  });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  return (
    <Modal open={open} title="团队包车申请" onCancel={onClose} width={560}
      onOk={async () => {
        if (!f.teamName || !f.useDate) return message.warning('团队名称与用车日期必填');
        await api.post('/charters', f);
        message.success('包车申请已提交调度配车');
        onDone();
      }}>
      <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
        <Space wrap>
          <Input addonBefore="团队" style={{ width: 240 }} value={f.teamName} onChange={e => set('teamName', e.target.value)} />
          <Input addonBefore="联系人" style={{ width: 240 }} value={f.contact} onChange={e => set('contact', e.target.value)} />
        </Space>
        <Space wrap>
          <Input addonBefore="电话" style={{ width: 240 }} value={f.phone} onChange={e => set('phone', e.target.value)} />
          <Input addonBefore="用车时间" style={{ width: 240 }} placeholder="2026-09-26 09:00"
            value={f.useDate} onChange={e => set('useDate', e.target.value)} />
        </Space>
        <Space wrap>
          <InputNumber addonBefore="人数" min={1} value={f.peopleCount} onChange={v => set('peopleCount', v)} />
          <InputNumber addonBefore="轮椅数" min={0} value={f.needWheelchair} onChange={v => set('needWheelchair', v)} />
          <Select style={{ width: 200 }} placeholder="上车站" value={f.startStationId} onChange={v => set('startStationId', v)}
            options={stations.map((s: any) => ({ value: s.id, label: s.name }))} />
        </Space>
        <Input.TextArea rows={2} placeholder="包车游览路线" value={f.routePlan} onChange={e => set('routePlan', e.target.value)} />
      </Space>
    </Modal>
  );
}

function AssignCharterModal({ order, dash, onClose, onDone }: any) {
  const [vehicleId, setVehicleId] = useState<number>();
  const [driverId, setDriverId] = useState<number>();
  if (!order) return null;
  return (
    <Modal open={!!order} title={`包车配车：${order.teamName}`} onCancel={onClose}
      onOk={async () => {
        try {
          await api.post(`/charters/${order.id}/assign`, { vehicleId, driverId });
          message.success('配车成功，车辆已预留');
          onDone();
        } catch (e: any) { message.error(e.message); }
      }}>
      <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
        <div>需要 <b>{order.peopleCount}</b> 座、轮椅位 <b>{order.needWheelchair}</b> 个</div>
        <Select style={{ width: '100%' }} placeholder="选择车辆" onChange={setVehicleId}
          options={(dash?.vehicles || []).map((v: any) => ({
            value: v.id,
            label: `${v.code} ${v.capacity}座 ♿${v.wheelchairSeats} 电量${v.battery}% ${v.reservedForCharter ? '(已预留)' : ''}`,
          }))} />
        <Select style={{ width: '100%' }} placeholder="选择司机" onChange={setDriverId}
          options={(dash?.drivers || []).map((d: any) => ({ value: d.id, label: d.name }))} />
      </Space>
    </Modal>
  );
}

function WeatherTab({ dash, refresh }: any) {
  const w = dash?.weather;
  const [condition, setCondition] = useState(w?.condition || '多云');
  const [tempC, setTempC] = useState(w?.tempC || 26);
  const [warning, setWarning] = useState(w?.warning || '');
  const [level, setLevel] = useState(w?.warningLevel || 0);
  const [rain, setRain] = useState(w?.rainfallMmH || 0);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title={<Space><CloudServerOutlined />天气与预警（橙色及以上自动触发停运预案入口）</Space>}>
        <Space wrap align="end">
          <div><div className="muted">天气</div><Input value={condition} onChange={e => setCondition(e.target.value)} style={{ width: 120 }} /></div>
          <div><div className="muted">温度℃</div><InputNumber value={tempC} onChange={v => setTempC(v || 0)} /></div>
          <div><div className="muted">预警</div><Input value={warning} onChange={e => setWarning(e.target.value)} style={{ width: 180 }} placeholder="如 暴雨橙色预警" /></div>
          <div><div className="muted">等级 0-4</div><InputNumber min={0} max={4} value={level} onChange={v => setLevel(v || 0)} /></div>
          <div><div className="muted">降雨 mm/h</div><InputNumber min={0} value={rain} onChange={v => setRain(v || 0)} /></div>
          <Button type="primary" onClick={async () => {
            await api.post('/weather', { condition, tempC, warning, warningLevel: level, rainfallMmH: rain });
            message.success('天气已更新，站务平板与派班规则同步生效');
            refresh();
          }}>更新天气</Button>
        </Space>
        {level >= 3 && (
          <Alert style={{ marginTop: 12 }} type="error" showIcon
            message={`${warning || '高级别气象预警'}：可执行全线临时停运`}
            action={<Popconfirm title="确认全线临时停运？在班车立即中断、候乘游客引导退票、已上车票自动转客服"
              onConfirm={async () => {
                const r = await api.post('/dispatch/storm-suspend', { reason: `${warning}，降雨量 ${rain}mm/h` });
                message.success(`已停运 ${r.suspendedTrips.length} 个班次`);
                refresh();
              }}>
              <Button danger type="primary">一键临时停运</Button>
            </Popconfirm>} />
        )}
      </Card>

      <Card title="道路管制（封闭=阻断派班；其他=提醒绕行）">
        <AddControl stations={dash?.stations || []} onDone={refresh} />
        <Table style={{ marginTop: 12 }} rowKey="id" size="small" pagination={false}
          dataSource={dash?.controls || []}
          columns={[
            { title: '路段', dataIndex: 'segment' },
            { title: '关联站点', key: 's', render: (_: any, r: any) =>
              (dash?.stations.find((s: any) => s.id === r.stationId)?.name) || '全线' },
            { title: '原因', dataIndex: 'reason' },
            { title: '状态', dataIndex: 'status', render: (s: string) =>
              s === 'active' ? <Tag color="orange">生效中</Tag> : <Tag>已解除</Tag> },
            {
              title: '操作', key: 'op',
              render: (_: any, r: any) => r.status === 'active' &&
                <Button size="small" onClick={async () => { await api.post(`/road-controls/${r.id}/lift`, {}); message.success('管制已解除'); refresh(); }}>解除</Button>,
            },
          ]} />
      </Card>
    </Space>
  );
}

function AddControl({ stations, onDone }: { stations: any[]; onDone: () => void }) {
  const [stationId, setStationId] = useState<number | undefined>();
  const [segment, setSegment] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Space wrap>
      <Select allowClear style={{ width: 180 }} placeholder="关联站点（可空=全线）" value={stationId} onChange={setStationId}
        options={stations.map(s => ({ value: s.id, label: s.name }))} />
      <Input style={{ width: 220 }} placeholder="路段，如 百花园—山顶 陡坡段" value={segment} onChange={e => setSegment(e.target.value)} />
      <Input style={{ width: 300 }} placeholder="原因（含“封闭”将阻断派班）" value={reason} onChange={e => setReason(e.target.value)} />
      <Button type="primary" onClick={async () => {
        if (!segment || !reason) return message.warning('请填写路段与原因');
        await api.post('/road-controls', { stationId, segment, reason });
        message.success('管制已发布');
        setSegment(''); setReason(''); onDone();
      }}>发布管制</Button>
    </Space>
  );
}

function vehicleStatus(s: string) {
  return ({ idle: '待命', running: '在运', charging: '充电', maintenance: '维保', breakdown: '故障' } as any)[s] || s;
}

/* ---------- 满载跳站处置（调度中心：查看同一条记录/增派空车/留座规则/主管复核） ---------- */

function SkipTab({ dash, refresh }: any) {
  const records: any[] = dash?.skipRecords || [];
  const [detailFor, setDetailFor] = useState<any>(null);
  const [extraFor, setExtraFor] = useState<any>(null);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon
        message="跳站记录会影响该站点下一轮调度：可临时增派空车直达接驳，或启用「车辆不满载离站」规则（为本站预留座位，上游检票链路自动锁定，杜绝再次满载越站）。处置须经站点负责人确认后，由调度主管复核。" />
      <Card title={<Space><WarningOutlined style={{ color: '#cf1322' }} />满载跳站记录（与站务/游客/客服共用同一记录）</Space>}>
        <Table rowKey="id" size="small" pagination={{ pageSize: 8 }} dataSource={records}
          locale={{ emptyText: '当前没有未闭环的满载跳站记录' }}
          columns={[
            { title: '编号', dataIndex: 'code', width: 130 },
            { title: '站点', key: 'st', render: (_: any, r: any) =>
              <Space direction="vertical" size={0}><b>{r.stationName}</b><span className="muted">{r.routeName}</span></Space> },
            { title: '跳站班次/车', key: 't', render: (_: any, r: any) =>
              <Space size={4}>{r.tripCode}<Tag>{r.vehicleCode}</Tag></Space> },
            { title: '车内人数', key: 'on', width: 90, render: (_: any, r: any) =>
              <Tag color="red">{r.onboardCount}/{r.capacity}</Tag> },
            { title: '滞留', key: 'w', width: 90, render: (_: any, r: any) => `${r.waitingGroups}组/${r.waitingPeople}人` },
            { title: '下一班预计', key: 'eta', width: 150, render: (_: any, r: any) =>
              <Space direction="vertical" size={0}>
                <b>{r.nextTripCode || '按计划间隔'}</b>
                <Tag color="orange">约 {r.nextEtaMinutes} 分钟</Tag>
              </Space> },
            { title: '状态/投诉', key: 's', width: 150, render: (_: any, r: any) =>
              <Space direction="vertical" size={2}>{skipStatusTag(r.status)}{complaintTag(r.complaintStatus)}</Space> },
            {
              title: '调度处置', key: 'op', width: 300,
              render: (_: any, r: any) => (
                <Space wrap>
                  <Button size="small" type="primary" disabled={!!r.reliefTripId}
                    onClick={() => setExtraFor(r)}>
                    {r.reliefTripId ? `已派 ${r.reliefTripCode}` : '临时增派空车'}
                  </Button>
                  <Button size="small" onClick={() => reserveModal(r, refresh)}>
                    {r.seatReserveSet > 0 ? `留座${r.seatReserveSet}·调整` : '设留座规则'}
                  </Button>
                  <Button size="small" ghost type="primary" disabled={!!r.dispatchReviewedAt}
                    onClick={() => reviewModal(r, refresh)}>主管复核</Button>
                  <Button size="small" type="link" onClick={() => setDetailFor(r)}>时间线</Button>
                </Space>
              ),
            },
          ]} />
      </Card>

      {records.filter(r => r.dispatchAction).length > 0 && (
        <Card title="已下发的调度处置">
          {records.filter(r => r.dispatchAction).map(r => (
            <div key={`a-${r.id}`} style={{ padding: '4px 0' }}>
                <Tag color="blue">{r.code}</Tag>{r.dispatchAction}
                {r.dispatchSupervisorNote && <span className="muted">｜主管复核：{r.dispatchSupervisorNote}</span>}
            </div>
          ))}
        </Card>
      )}

      {detailFor && (
        <Modal open title={`${detailFor.code} 跳站处理时间线`} footer={null} width={660}
          onCancel={() => setDetailFor(null)}>
          <div style={{ marginBottom: 8 }}>
            <b>跳站原因：</b>{detailFor.reason}
          </div>
          <SkipRecordTimeline rec={detailFor} />
        </Modal>
      )}
      <ExtraVehicleModal rec={extraFor} dash={dash} onClose={() => setExtraFor(null)}
        onDone={() => { setExtraFor(null); refresh(); }} />
    </Space>
  );
}

function reserveModal(r: any, refresh: () => void) {
  let seats = r.seatReserveSet || 2;
  Modal.confirm({
    title: `调整车辆不满载离站规则：${r.stationName}`,
    width: 560,
    content: (
      <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
        <Space>
          为本站预留座位
          <InputNumber id="rv-seats" min={0} max={20} defaultValue={seats}
            onChange={v => { seats = v || 0; }} /> 个
        </Space>
        <Input.TextArea id="rv-note" rows={2} placeholder="备注（可选）" />
        <span className="muted">设置后，途经本站的后续车辆在上游站检票时自动锁定该座位数，不得卖满；设为 0 解除规则。</span>
      </Space>
    ),
    onOk: async () => {
      const note = (document.getElementById('rv-note') as HTMLTextAreaElement)?.value || '';
      await api.post(`/skip-records/${r.id}/seat-reserve`, { seats, note });
      message.success(seats === 0 ? '留座规则已解除' : `已设置留座 ${seats} 座`);
      refresh();
    },
  });
}

function reviewModal(r: any, refresh: () => void) {
  if (!r.stationConfirmedAt) {
    message.warning('须先由站点负责人确认跳站情况，调度主管才能复核');
    return;
  }
  Modal.confirm({
    title: `调度主管复核：${r.code}（${r.stationName}）`,
    width: 560,
    content: <Input.TextArea id="rv-review" rows={3}
      defaultValue="复核通过：跳站原因、游客补偿与调度处置（增派空车/留座规则）均已落实" />,
    onOk: async () => {
      const note = (document.getElementById('rv-review') as HTMLTextAreaElement)?.value || '';
      await api.post(`/skip-records/${r.id}/dispatch-review`, { reviewerName: '调度主管', note });
      message.success('复核完成（无未决投诉时记录自动闭环）');
      refresh();
    },
  });
}

function ExtraVehicleModal({ rec, dash, onClose, onDone }: any) {
  const idleVehicles = (dash?.vehicles || []).filter((v: any) =>
    v.status === 'idle' && !v.reservedForCharter && v.battery >= 20);
  const freeDrivers = (dash?.drivers || []).filter((d: any) =>
    ['on_duty'].includes(d.status) && !d.restRequired);
  const [vehicleId, setVehicleId] = useState<number>();
  const [driverId, setDriverId] = useState<number>();
  const [note, setNote] = useState('');
  if (!rec) return null;
  return (
    <Modal open={!!rec} title={`临时增派空车接驳：${rec.stationName}（${rec.code}）`}
      onCancel={onClose} width={560}
      onOk={async () => {
        if (!vehicleId || !driverId) return message.warning('请选择车辆与司机');
        try {
          const r = await api.post(`/skip-records/${rec.id}/dispatch-extra-vehicle`, { vehicleId, driverId, note });
          message.success(`已增派 ${r.reliefTripCode} 空车前往，滞留游客自动转回排队`);
          onDone();
        } catch (e: any) { message.error(e.message); }
      }}>
      <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
        <Alert type="warning" showIcon
          message={`空车将以「${rec.stationName}」为起点立即开始上客，滞留 ${rec.waitingPeople} 人自动转回排队优先检票；仅可派待命、电量≥20%、非包车预留车辆。`} />
        <Select style={{ width: '100%' }} placeholder="选择空车" value={vehicleId} onChange={setVehicleId}
          options={idleVehicles.map((v: any) => ({
            value: v.id,
            label: `${v.code} ${v.capacity}座 ♿${v.wheelchairSeats} 电量${v.battery}%`,
          }))} />
        <Select style={{ width: '100%' }} placeholder="选择司机" value={driverId} onChange={setDriverId}
          options={freeDrivers.map((d: any) => ({
            value: d.id, label: `${d.name}（工时 ${d.workMinutesToday}/${d.maxWorkMinutes} 分）`,
          }))} />
        <Input.TextArea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="调度备注（可选）" />
      </Space>
    </Modal>
  );
}
