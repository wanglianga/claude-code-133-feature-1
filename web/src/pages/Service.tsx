import { useState } from 'react';
import {
  Card, Table, Tag, Space, Button, Tabs, Badge, Modal, Input, Select, message, Typography, Alert, Empty,
} from 'antd';
import { api, fen, TICKET_TYPE } from '../api';
import { useApi } from '../hooks';
import { EtaText, SkipRecordTimeline, skipStatusTag } from '../components/SkipShared';

const FAULT_LABEL: Record<string, string> = {
  visitor: '游客自身', storm: '暴雨停运', vehicle: '车辆故障', schedule: '调度延误', other: '其他',
};
const REFUND_STATUS: Record<string, { text: string; color: string }> = {
  pending: { text: '待审核', color: 'orange' },
  approved: { text: '已核准待付款', color: 'blue' },
  rejected: { text: '已驳回', color: 'red' },
  escalated: { text: '主管处理中', color: 'purple' },
  paid: { text: '已退款', color: 'green' },
};

export default function ServicePage() {
  const [tick, setTick] = useState(0);
  const { data: wb } = useApi<any>(`/service/workbench?t=${tick}`, [tick]);
  const { data: incidents } = useApi<any[]>(`/incidents?t=${tick}`, [tick]);
  const refresh = () => setTick(t => t + 1);

  const pending = wb?.pendingRefunds || [];
  const escalated = wb?.escalatedRefunds || [];
  const skipComplaints = wb?.skipComplaints || [];

  const refundCols = (mode: 'agent' | 'supervisor') => [
    { title: '退票单', dataIndex: 'code', width: 150 },
    {
      title: '车票/游客', key: 't',
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <b>{r.ticket?.visitorName}（{r.ticket?.partySize}人）</b>
          <span className="muted">{r.ticket?.code} · {TICKET_TYPE[r.ticket?.type]}</span>
        </Space>
      ),
    },
    { title: '金额', dataIndex: 'amount', width: 100, render: (n: number) => <b>{fen(n)}</b> },
    { title: '原因', key: 'r', render: (_: any, r: any) =>
      <Space direction="vertical" size={0}><span>{r.reason}</span><Tag>{FAULT_LABEL[r.faultTag]}</Tag></Space> },
    { title: '状态', dataIndex: 'status', width: 110,
      render: (s: string) => <Tag color={REFUND_STATUS[s]?.color}>{REFUND_STATUS[s]?.text}</Tag> },
    {
      title: mode === 'agent' ? '客服处理' : '客服主管裁决', key: 'op', width: 320,
      render: (_: any, r: any) => mode === 'agent' ? (
        <Space wrap>
          <Button size="small" type="primary" onClick={() => decideModal(r, true, refresh)}>同意退款</Button>
          <Button size="small" danger onClick={() => decideModal(r, false, refresh)}>驳回</Button>
          <Button size="small" ghost onClick={() => escalateModal(r, refresh)}>争议升级主管</Button>
        </Space>
      ) : (
        <Space wrap>
          <Button size="small" type="primary" onClick={() => supervisorModal(r, true, refresh)}>裁决同意</Button>
          <Button size="small" danger onClick={() => supervisorModal(r, false, refresh)}>维持驳回</Button>
        </Space>
      ),
    },
  ];

  const openIncidents = (incidents || []).filter(i => ['open', 'processing', 'escalated'].includes(i.status));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert type="info" showIcon
        message="客服工作台：游客退票、优先乘车争议、误乘与跳站投诉在此受理；责任不清的退票争议一键升级客服主管；同一张票/同一班车的全部沟通都沉淀在事件时间线。" />
      <div className="stat-row">
        <div className="stat-card"><div className="l">待审退票</div><div className="v" style={{ color: '#d46b08' }}>{wb?.counts?.pendingRefund ?? 0}</div></div>
        <div className="stat-card"><div className="l">主管处理中</div><div className="v" style={{ color: '#722ed1' }}>{wb?.counts?.escalated ?? 0}</div></div>
        <div className="stat-card"><div className="l">跳站投诉</div><div className="v" style={{ color: '#cf1322' }}>{wb?.counts?.skipComplaint ?? 0}</div></div>
        <div className="stat-card"><div className="l">待处理事件</div><div className="v">{wb?.counts?.openIncident ?? 0}</div></div>
      </div>

      <Tabs
        items={[
          {
            key: 'skip',
            label: <Badge count={skipComplaints.length} size="small">满载跳站投诉</Badge>,
            children: <SkipComplaintTable records={skipComplaints} refresh={refresh} />,
          },
          {
            key: 'pending',
            label: <Badge count={pending.length} size="small">退票审核</Badge>,
            children: <Table rowKey="id" size="small" pagination={false} dataSource={pending}
              columns={refundCols('agent')} locale={{ emptyText: <Empty description="没有待审退票" /> }} />,
          },
          {
            key: 'escalated',
            label: <Badge count={escalated.length} size="small">主管争议裁决</Badge>,
            children: <Table rowKey="id" size="small" pagination={false} dataSource={escalated}
              columns={refundCols('supervisor')} locale={{ emptyText: <Empty description="没有升级争议" /> }} />,
          },
          {
            key: 'incidents',
            label: <Badge count={openIncidents.length} size="small">事件协同（票/班车）</Badge>,
            children: <IncidentTable incidents={openIncidents} refresh={refresh} />,
          },
        ]}
      />
    </Space>
  );
}

function SkipComplaintTable({ records, refresh }: { records: any[]; refresh: () => void }) {
  const [detailFor, setDetailFor] = useState<any>(null);
  const [handleFor, setHandleFor] = useState<any>(null);
  const [resolution, setResolution] = useState<'compensation' | 'transfer' | 'refund_guide' | 'explain'>('compensation');
  const [note, setNote] = useState('已电话联系游客说明情况');

  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="客服用同一条跳站记录处理投诉：记录内含跳站原因、车内人数、下一班预计到达、站点确认与调度处置（增派空车/留座规则），无需再向站点/调度反复核实。" />
      <Table rowKey="id" size="small" pagination={false} dataSource={records}
        locale={{ emptyText: <Empty description="暂无跳站投诉" /> }}
        columns={[
          { title: '跳站记录', dataIndex: 'code', width: 130 },
          { title: '站点/线路', key: 's', render: (_: any, r: any) =>
            <Space direction="vertical" size={0}><b>{r.stationName}</b><span className="muted">{r.routeName}</span></Space> },
          { title: '事实依据', key: 'fact',
            render: (_: any, r: any) => (
              <Space direction="vertical" size={0}>
                <span><Tag color="red">车内 {r.onboardCount}/{r.capacity}</Tag>滞留 {r.waitingPeople} 人</span>
                <span className="muted">跳站班次 {r.tripCode} · {r.vehicleCode}</span>
              </Space>
            ) },
          { title: '下一班', key: 'eta', width: 140, render: (_: any, r: any) => <EtaText rec={r} /> },
          { title: '确认/处置', key: 'cf',
            render: (_: any, r: any) => (
              <Space direction="vertical" size={0}>
                <span>{r.stationConfirmedAt
                  ? <Tag color="green">站点已确认·{r.stationConfirmedBy}</Tag>
                  : <Tag color="orange">待站点确认</Tag>}</span>
                <span className="muted">{r.dispatchAction || '调度处置中'}</span>
                <span>{r.dispatchReviewedAt ? <Tag color="blue">主管已复核</Tag> : <Tag>待主管复核</Tag>}</span>
              </Space>
            ) },
          { title: '状态', key: 'st', width: 110, render: (_: any, r: any) => skipStatusTag(r.status) },
          {
            title: '客服处理', key: 'op', width: 200,
            render: (_: any, r: any) => (
              <Space wrap>
                <Button size="small" type="primary" onClick={() => { setHandleFor(r); setResolution('compensation'); setNote('已电话联系游客说明情况'); }}>
                  办结投诉
                </Button>
                <Button size="small" type="link" onClick={() => setDetailFor(r)}>完整记录</Button>
              </Space>
            ),
          },
        ]} />

      {detailFor && (
        <Modal open title={`${detailFor.code} 跳站解释全记录`} footer={null} width={680}
          onCancel={() => setDetailFor(null)}>
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            <div><b>跳站原因：</b>{detailFor.reason}</div>
            <div><b>等待补偿：</b>{detailFor.compensation}</div>
            <div><b>换乘建议：</b>{detailFor.transferAdvice}</div>
            <div><b>等候策略：</b>{detailFor.waitingPolicy}</div>
            {detailFor.affectedGroups?.length > 0 && (
              <div><b>受影响游客：</b>
                {detailFor.affectedGroups.map((g: any) =>
                  <Tag key={g.entryId}>{g.visitorName}（{g.ticketCode}，{g.partySize}人）</Tag>)}
              </div>
            )}
            <SkipRecordTimeline rec={detailFor} />
          </Space>
        </Modal>
      )}

      {handleFor && (
        <Modal open title={`办结跳站投诉：${handleFor.code}（${handleFor.stationName}）`}
          onCancel={() => setHandleFor(null)}
          onOk={async () => {
            await api.post(`/skip-records/${handleFor.id}/complaint/handle`, { resolution, note, agentName: '客服' });
            message.success('投诉已办结，结论同步至游客车票页与跳站时间线');
            setHandleFor(null);
            refresh();
          }}>
          <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
            <Select style={{ width: '100%' }} value={resolution} onChange={v => setResolution(v)}
              options={[
                { value: 'compensation', label: '发放等待补偿（水/礼品/8折券）' },
                { value: 'transfer', label: '安排换乘/电瓶车短驳' },
                { value: 'refund_guide', label: '引导全额退票（调度责任）' },
                { value: 'explain', label: '仅解释原因与下一班时刻' },
              ]} />
            <Input.TextArea rows={3} value={note} onChange={e => setNote(e.target.value)} />
          </Space>
        </Modal>
      )}
    </>
  );
}

function IncidentTable({ incidents, refresh }: { incidents: any[]; refresh: () => void }) {
  return (
    <Table rowKey="id" size="small" pagination={{ pageSize: 8 }} dataSource={incidents}
      columns={[
        { title: '编号', dataIndex: 'code', width: 140 },
        { title: '类型', dataIndex: 'type', width: 110, render: (t: string) => <Tag>{incidentType(t)}</Tag> },
        {
          title: '标题/详情', key: 'title',
          render: (_: any, r: any) => (
            <Space direction="vertical" size={0}>
              <Typography.Text strong>{r.title}</Typography.Text>
              <span className="muted">{r.detail}</span>
            </Space>
          ),
        },
        { title: '级别', dataIndex: 'severity', width: 80, render: (s: string) =>
          <Tag color={s === 'critical' ? 'red' : s === 'warn' ? 'orange' : 'default'}>
            {s === 'critical' ? '紧急' : s === 'warn' ? '预警' : '信息'}</Tag> },
        { title: '当前归属', dataIndex: 'ownerRole', width: 100, render: (r: string) => roleName(r) },
        { title: '状态', dataIndex: 'status', width: 90, render: (s: string) =>
          <Tag color={s === 'escalated' ? 'purple' : s === 'open' ? 'orange' : 'blue'}>
            {s === 'open' ? '待处理' : s === 'processing' ? '处理中' : '已升级'}</Tag> },
        {
          title: '操作', key: 'op', width: 220,
          render: (_: any, r: any) => (
            <Space wrap>
              <Button size="small" onClick={async () => { await api.post(`/incidents/${r.id}/take`, { role: 'service' }); message.success('已领取'); refresh(); }}>领取</Button>
              <Button size="small" type="primary" ghost
                onClick={() => Modal.confirm({
                  title: '处理结果',
                  content: <Input.TextArea id="resolve-text" rows={3} placeholder="记录处置结论，将同步给游客/站务/调度/财务" />,
                  onOk: async () => {
                    const text = (document.getElementById('resolve-text') as HTMLTextAreaElement)?.value || '已处理';
                    await api.post(`/incidents/${r.id}/resolve`, { role: 'service', resolution: text });
                    message.success('事件已闭环'); refresh();
                  },
                })}>闭环处理</Button>
              <Button size="small" type="link" onClick={() => timelineModal(r)}>时间线</Button>
            </Space>
          ),
        },
      ]} />
  );
}

function decideModal(r: any, approve: boolean, refresh: () => void) {
  Modal.confirm({
    title: approve ? `同意退款 ${fen(r.amount)}` : `驳回退票（${r.ticket?.visitorName}）`,
    width: 500,
    content: <Input.TextArea id="decide-note" rows={3}
      defaultValue={approve ? defaultApproveNote(r) : '经核实不满足退改规则，驳回'} />,
    onOk: async () => {
      const note = (document.getElementById('decide-note') as HTMLTextAreaElement)?.value || '';
      if (approve) await api.post(`/refunds/${r.id}/approve`, { note });
      else await api.post(`/refunds/${r.id}/reject`, { note });
      message.success(approve ? '已核准，流转财务付款' : '已驳回');
      refresh();
    },
  });
}

function escalateModal(r: any, refresh: () => void) {
  Modal.confirm({
    title: '升级客服主管裁决',
    width: 500,
    content: <Input.TextArea id="esc-note" rows={3}
      defaultValue="游客与站务对优先规则/责任界定存在争议，申请主管裁决" />,
    onOk: async () => {
      const note = (document.getElementById('esc-note') as HTMLTextAreaElement)?.value || '';
      await api.post(`/refunds/${r.id}/escalate`, { note });
      message.success('已升级，主管可在“主管争议裁决”页处理');
      refresh();
    },
  });
}

function supervisorModal(r: any, approve: boolean, refresh: () => void) {
  Modal.confirm({
    title: `客服主管裁决：${approve ? '同意退款' : '维持驳回'}（${r.ticket?.visitorName}）`,
    width: 500,
    content: <Input.TextArea id="sup-note" rows={3}
      defaultValue={approve ? '主管裁决：同意全额退款，站点加强优先乘车规则说明' : '主管裁决：维持驳回'} />,
    onOk: async () => {
      const note = (document.getElementById('sup-note') as HTMLTextAreaElement)?.value || '';
      await api.post(`/refunds/${r.id}/supervisor-decide`, { approve, note });
      message.success('裁决已生效'); refresh();
    },
  });
}

function timelineModal(r: any) {
  Modal.info({
    title: `${r.code} 事件时间线`,
    width: 600,
    content: (
      <div className="timeline-box">
        {(r.timeline || []).map((t: any, i: number) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <b>{new Date(t.at).toLocaleString('zh-CN')} · {roleName(t.role)}</b>
            <div>{t.text}</div>
          </div>
        ))}
      </div>
    ),
  });
}

function defaultApproveNote(r: any) {
  if (r.faultTag === 'storm') return '暴雨停运无责退票，全额';
  if (r.faultTag === 'vehicle') return '车辆故障无责退票，全额';
  if (r.faultTag === 'schedule') return '调度延误，协商全额退款';
  return '核实后同意退款';
}

function incidentType(t: string) {
  return ({
    long_queue: '排队过长', skip_station: '满载跳站', wrong_direction: '误乘反方向',
    priority_dispute: '优先争议', vehicle_fault: '车辆故障', handover_delay: '交班延误',
    storm_suspension: '暴雨停运', refund_request: '退票诉求', charter: '包车', info: '信息',
  } as Record<string, string>)[t] || t;
}
function roleName(r: string) {
  return ({
    visitor: '游客', staff: '站务', driver: '司机', dispatch: '调度',
    service: '客服', service_supervisor: '客服主管', finance: '财务', system: '系统',
  } as Record<string, string>)[r] || r;
}
