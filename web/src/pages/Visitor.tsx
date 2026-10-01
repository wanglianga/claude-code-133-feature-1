import { useMemo, useState } from 'react';
import {
  Card, Form, Select, InputNumber, Input, Button, Switch, Tag, Timeline, Typography,
  Space, Alert, Divider, Descriptions, Modal, Empty,
} from 'antd';
import { api, fen, TICKET_TYPE, TICKET_STATUS } from '../api';
import { useAction, useApi } from '../hooks';

export default function VisitorPage() {
  const { data: routesData } = useApi<any[]>('/routes');
  const [form] = Form.useForm();
  const [bought, setBought] = useState<any>(null);
  const [queryCode, setQueryCode] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const run = useAction();

  const flatStations = useMemo(
    () => (routesData || []).flatMap(r => r.stations.map((s: any) => ({ ...s, routeName: r.name }))),
    [routesData],
  );

  const buy = async () => {
    const v = await form.validateFields();
    const t = await run(() => api.post('/tickets', v), '购票成功，已记录入园信息');
    setBought(t);
    setQueryCode(t.code);
    search(t.code);
    form.resetFields();
  };

  const search = async (code?: string) => {
    const c = (code ?? queryCode).trim();
    if (!c) return;
    try {
      setDetail(await api.get(`/tickets/code/${c}`));
    } catch (e: any) {
      setDetail({ error: e.message });
    }
  };

  const requestRefund = () => {};
  void requestRefund;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="stat-row">
        <div className="stat-card"><div className="l">单程票</div><div className="v">¥20/人</div></div>
        <div className="stat-card"><div className="l">环线票（当日不限乘次）</div><div className="v">¥35/人</div></div>
        <div className="stat-card"><div className="l">亲子票（含儿童）</div><div className="v">¥30/人</div></div>
        <div className="stat-card"><div className="l">无障碍优先票（老人/轮椅优先进站）</div><div className="v">¥20/人</div></div>
      </div>

      <Card title="① 购票（入园时间、起终点站、同行与游览路线自动记录）">
        <Form form={form} layout="vertical" initialValues={{
          type: 'single', partySize: 1, hasStroller: false, hasElder: false,
          hasChild: false, needWheelchair: false,
        }}>
          <Space wrap align="start">
            <Form.Item name="type" label="票种" rules={[{ required: true }]}>
              <Select style={{ width: 180 }} options={Object.entries(TICKET_TYPE).map(([k, v]) => ({ value: k, label: v }))} />
            </Form.Item>
            <Form.Item name="visitorName" label="游客姓名" rules={[{ required: true }]}>
              <Input placeholder="如：张敏" style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="phone" label="手机号">
              <Input placeholder="可选" style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="partySize" label="同行人数" rules={[{ required: true }]}>
              <InputNumber min={1} max={20} style={{ width: 110 }} addonAfter="人" />
            </Form.Item>
          </Space>
          <Space wrap align="start">
            <Form.Item name="originStationId" label="起点站" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" style={{ width: 200 }}
                options={flatStations.map(s => ({ value: s.id, label: `${s.routeName} · ${s.name}` }))}
                placeholder="选择上车站" />
            </Form.Item>
            <Form.Item name="destStationId" label="终点站" rules={[{ required: true }]}>
              <Select showSearch optionFilterProp="label" style={{ width: 200 }}
                options={flatStations.map(s => ({ value: s.id, label: `${s.routeName} · ${s.name}` }))}
                placeholder="环线票可与起点相同" />
            </Form.Item>
            <Form.Item name="plannedRoute" label="预计游览路线">
              <Input placeholder="如：东门→山顶→玻璃栈道" style={{ width: 240 }} />
            </Form.Item>
          </Space>
          <Space wrap size={24}>
            <Form.Item name="hasStroller" label="携带婴儿车" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="hasElder" label="同行老人" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="hasChild" label="同行儿童" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="needWheelchair" label="需要轮椅位" valuePropName="checked"><Switch /></Form.Item>
            <Button type="primary" size="large" onClick={buy}>确认购票</Button>
          </Space>
        </Form>
        {bought && (
          <Alert
            style={{ marginTop: 8 }}
            type="success" showIcon
            message={`购票成功：${bought.code}（${TICKET_TYPE[bought.type]}），金额 ${fen(bought.price)}`}
            description="请在上车站扫码排队；无障碍/老人票自动进入优先组。可在下方输入票号查看全程动态。"
          />
        )}
      </Card>

      <Card title="② 我的车票 · 全程时间线（排队 / 检票 / 事件 / 退票围绕同一张票）"
        extra={
          <Space>
            <Input value={queryCode} onChange={e => setQueryCode(e.target.value)}
              placeholder="输入票号，如 T20260925-001" style={{ width: 220 }} onPressEnter={() => search()} />
            <Button onClick={() => search()}>查询</Button>
          </Space>
        }>
        {!detail ? (
          <Empty description="输入票号查询。种子示例：T20260925-001 ~ T20260925-006" />
        ) : detail.error ? (
          <Alert type="error" showIcon message={detail.error} />
        ) : (
          <TicketDetail detail={detail} onRefund={requestRefund} onChanged={() => search()} />
        )}
      </Card>
    </Space>
  );
}

function RefundForm({ setValues }: { setValues?: (v: any) => void }) {
  const [reason, setReason] = useState('游客个人原因申请退票');
  const [faultTag, setFaultTag] = useState('visitor');
  // 挂载时通过自定义事件把值传出
  if (setValues) setTimeout(() => setValues({ reason, faultTag }), 0);
  return (
    <Space direction="vertical" style={{ marginTop: 12, width: '100%' }}>
      <Select value={faultTag} onChange={setFaultTag} style={{ width: '100%' }}
        options={[
          { value: 'visitor', label: '游客自身原因' },
          { value: 'storm', label: '暴雨停运' },
          { value: 'vehicle', label: '车辆故障' },
          { value: 'schedule', label: '调度/排队延误' },
          { value: 'other', label: '其他' },
        ]} />
      <Input.TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} />
    </Space>
  );
}

function TicketDetail({ detail, onRefund, onChanged }: { detail: any; onRefund: () => void; onChanged: () => void }) {
  const { ticket, origin, dest, incidents, typeLabel } = detail;
  const st = TICKET_STATUS[ticket.status];
  const canRefund = ['valid', 'queued'].includes(ticket.status);

  const refund = () => {
    let values: any = { reason: '游客个人原因申请退票', faultTag: 'visitor' };
    Modal.confirm({
      title: `申请退票（${fen(ticket.price)}）`,
      width: 480,
      content: <RefundForm setValues={v => { values = v; }} />,
      onOk: async () => {
        await api.post(`/tickets/${ticket.id}/refund`, values);
        onChanged();
      },
    });
  };

  return (
    <div>
      <Descriptions column={3} bordered size="small">
        <Descriptions.Item label="票号">{ticket.code}</Descriptions.Item>
        <Descriptions.Item label="票种">{typeLabel}</Descriptions.Item>
        <Descriptions.Item label="状态"><Tag color={st.color}>{st.text}</Tag></Descriptions.Item>
        <Descriptions.Item label="游客">{ticket.visitorName}（{ticket.partySize} 人）</Descriptions.Item>
        <Descriptions.Item label="行程">{origin.name} → {dest.name}</Descriptions.Item>
        <Descriptions.Item label="方向">{ticket.expectedDirection === 'forward' ? '上行' : ticket.expectedDirection === 'backward' ? '下行' : '环线'}</Descriptions.Item>
        <Descriptions.Item label="特殊需求" span={3}>
          {[
            ticket.hasStroller && '婴儿车', ticket.hasElder && '老人',
            ticket.hasChild && '儿童', ticket.needWheelchair && '轮椅位', ticket.priority && '优先组',
          ].filter(Boolean).map(x => <Tag key={x} color="green">{x}</Tag>) || '无'}
          <Typography.Text type="secondary"> ｜路线：{ticket.plannedRoute}</Typography.Text>
        </Descriptions.Item>
      </Descriptions>
      <Divider orientation="left" style={{ fontSize: 13 }}>事件时间线（游客 / 站务 / 司机 / 调度 / 客服 / 财务）</Divider>

      {detail.skipRecords?.length > 0 && (
        <SkipAlerts records={detail.skipRecords} onChanged={onChanged} />
      )}

      <Timeline
        items={incidents.flatMap((inc: any) => {
          const notes = inc.timeline?.length ? inc.timeline : [{ at: inc.createdAt, role: inc.raisedByRole, text: inc.title }];
          return notes.map((n: any, i: number) => ({
            color: inc.severity === 'critical' ? 'red' : inc.severity === 'warn' ? 'orange' : 'green',
            children: (
              <div key={`${inc.id}-${i}`}>
                <Typography.Text strong>{i === 0 ? inc.title : '处理记录'}</Typography.Text>
                <span className="muted" style={{ marginLeft: 8 }}>{new Date(n.at).toLocaleString('zh-CN')} · {roleName(n.role)}</span>
                <div>{n.text}{inc.resolution ? `｜结论：${inc.resolution}` : ''}</div>
              </div>
            ),
          }));
        })}
      />
      <Space>
        <Button danger disabled={!canRefund} onClick={refund}>
          {canRefund ? '申请退票' : '当前状态不可直接退票（如已上车请联系客服争议处理）'}
        </Button>
      </Space>
    </div>
  );
}

function SkipAlerts({ records, onChanged }: { records: any[]; onChanged: () => void }) {
  const [showTransfer, setShowTransfer] = useState<number | null>(null);
  return (
    <Space direction="vertical" style={{ width: '100%', marginBottom: 8 }}>
      {records.map((r: any) => (
        <Alert
          key={r.id}
          type="error" showIcon
          message={<Space wrap>
            <b>您乘坐的上一班车在「{r.stationName}」满载跳站（{r.code}）</b>
            {SKIP_STATUS[r.status]}
            {r.confirmedBy && <Tag color="blue">站点负责人 {r.confirmedBy} 已确认</Tag>}
            {r.reviewedBy && <Tag color="purple">调度主管 {r.reviewedBy} 已复核</Tag>}
          </Space>}
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div>跳站时车内 <b>{r.onboardCount}/{r.capacity}</b> 人（满载），站台 {r.platformPeople} 人未能上车；
                下一班 <b>{r.nextVehicleCode}</b> 预计 <b>{r.nextEtaMinutes}</b> 分钟后（{new Date(r.nextEtaAt).toLocaleTimeString('zh-CN')}）到站。</div>
              <div><Tag color="orange">等待补偿</Tag>{r.compensationNote}</div>
              <div>
                <Button size="small" type="link" style={{ padding: 0 }}
                  onClick={() => setShowTransfer(showTransfer === r.id ? null : r.id)}>
                  {showTransfer === r.id ? '收起换乘建议' : '查看等待补偿与换乘建议'}
                </Button>
                <Button size="small" type="link" danger
                  onClick={() => complaintModal(r, onChanged)}>我要投诉</Button>
              </div>
              {showTransfer === r.id && (
                <div style={{ background: '#fafafa', padding: 8, borderRadius: 6 }}>
                  <div><Tag>换乘建议</Tag>{r.transferNote}</div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    站点等候策略：{r.waitPolicy || '站点同步中…'}
                  </div>
                  {r.dispatchAction !== 'pending' && r.dispatchAction !== 'none' && (
                    <div style={{ marginTop: 4 }}>调度处置：{r.dispatchNote}</div>
                  )}
                  {r.extraTripCode && <div style={{ marginTop: 4 }}>调度已临时增派空车 <b>{r.extraTripCode}</b>，空车到站后跳站游客优先上客。</div>}
                  {r.complaintCount > 0 && <div style={{ marginTop: 4 }} className="muted">本记录已有 {r.complaintCount} 起投诉，由客服基于同一记录处理。</div>}
                </div>
              )}
            </Space>
          }
        />
      ))}
    </Space>
  );
}

function complaintModal(r: any, onDone: () => void) {
  Modal.confirm({
    title: `就跳站记录 ${r.code} 发起投诉`,
    width: 480,
    content: (
      <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
        <Input id="cp-name" placeholder="您的称呼（可选）" />
        <Input.TextArea id="cp-text" rows={3} placeholder="描述投诉内容，客服将基于同一条跳站记录处理" />
      </Space>
    ),
    onOk: async () => {
      const visitorName = (document.getElementById('cp-name') as HTMLInputElement)?.value || '游客';
      const content = (document.getElementById('cp-text') as HTMLTextAreaElement)?.value || '';
      await api.post(`/skip-records/${r.id}/complaint`, { visitorName, content });
      onDone();
    },
  });
}

const SKIP_STATUS: Record<string, any> = {
  recorded: <Tag color="orange">待站点负责人确认</Tag>,
  confirmed: <Tag color="blue">待调度主管复核</Tag>,
  reviewed: <Tag color="purple">主管已复核·投诉处理中</Tag>,
  closed: <Tag color="green">已闭环</Tag>,
};

function roleName(r: string) {
  return ({
    visitor: '游客', staff: '站务', driver: '司机', dispatch: '调度',
    service: '客服', service_supervisor: '客服主管', finance: '财务', system: '系统',
  } as Record<string, string>)[r] || r;
}
