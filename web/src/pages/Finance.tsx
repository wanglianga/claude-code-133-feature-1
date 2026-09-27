import { useState } from 'react';
import { Card, Table, Tag, Space, Button, Statistic, Row, Col, Input, Modal, message, Empty, Tabs } from 'antd';
import { api, fen, TICKET_TYPE } from '../api';
import { useApi } from '../hooks';

export default function FinancePage() {
  const [tick, setTick] = useState(0);
  const { data: refunds } = useApi<any[]>(`/tickets/refunds?t=${tick}`, [tick]);
  const refresh = () => setTick(t => t + 1);

  const rows = refunds || [];
  const approved = rows.filter(r => r.status === 'approved');
  const paid = rows.filter(r => r.status === 'paid');
  const pending = rows.filter(r => r.status === 'pending');

  const pay = (r: any) => Modal.confirm({
    title: `出账退款 ${fen(r.amount)}`,
    content: <Space direction="vertical" style={{ marginTop: 8 }}>
      <div>退票单 {r.code}｜{r.ticket?.visitorName}｜{r.ticket?.code}</div>
      <Input id="pay-note" defaultValue="原路退回付款账户" style={{ width: 380 }} />
    </Space>,
    onOk: async () => {
      const note = (document.getElementById('pay-note') as HTMLInputElement)?.value || '原路退回';
      await api.post(`/refunds/${r.id}/pay`, { note });
      message.success('退款已出账，事件自动闭环并通知游客/客服');
      refresh();
    },
  });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="stat-row">
        <div className="stat-card"><div className="l">待付款（已核准）</div>
          <div className="v" style={{ color: '#1677ff' }}>{approved.length} 笔</div></div>
        <div className="stat-card"><div className="l">待付款金额</div>
          <div className="v">{fen(approved.reduce((a, r) => a + r.amount, 0))}</div></div>
        <div className="stat-card"><div className="l">今日已退款</div>
          <div className="v" style={{ color: '#389e0d' }}>{fen(paid.reduce((a, r) => a + r.amount, 0))}</div></div>
        <div className="stat-card"><div className="l">客服审核中</div>
          <div className="v">{pending.length} 笔</div></div>
      </div>

      <Tabs
        items={[
          {
            key: 'approved', label: `待出账（${approved.length}）`,
            children: (
              <Table rowKey="id" size="small" pagination={false} dataSource={approved}
                locale={{ emptyText: <Empty description="暂无待付款退票" /> }}
                columns={refundCols(r => <Button type="primary" size="small" onClick={() => pay(r)}>出账退款</Button>)} />
            ),
          },
          {
            key: 'all', label: '全部退票单',
            children: <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} dataSource={rows}
              columns={refundCols()} />,
          },
        ]}
      />
    </Space>
  );
}

function refundCols(action?: (r: any) => React.ReactNode) {
  return [
    { title: '退票单', dataIndex: 'code', width: 150 },
    { title: '游客', key: 'v', render: (_: any, r: any) =>
      <Space direction="vertical" size={0}><b>{r.ticket?.visitorName}</b>
        <span className="muted">{r.ticket?.code} · {TICKET_TYPE[r.ticket?.type]}</span></Space> },
    { title: '金额', dataIndex: 'amount', width: 100, render: (n: number) => <b>{fen(n)}</b> },
    { title: '责任归类', dataIndex: 'faultTag', width: 100, render: (f: string) =>
      <Tag color={f === 'visitor' ? 'default' : f === 'storm' ? 'blue' : f === 'vehicle' ? 'red' : 'orange'}>
        {({ visitor: '游客', storm: '暴雨', vehicle: '车辆', schedule: '调度', other: '其他' } as any)[f]}
      </Tag> },
    { title: '客服意见', dataIndex: 'serviceNote', ellipsis: true },
    { title: '主管意见', dataIndex: 'supervisorNote', ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 110, render: (s: string) =>
      <Tag color={({
        pending: 'orange', approved: 'blue', rejected: 'red', escalated: 'purple', paid: 'green',
      } as any)[s]}>
        {({ pending: '待审核', approved: '待付款', rejected: '已驳回', escalated: '主管中', paid: '已退款' } as any)[s]}
      </Tag> },
    { title: '出账时间', dataIndex: 'paidAt', width: 170, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
    ...(action ? [{ title: '操作', key: 'op', width: 120, render: (_: any, r: any) => action(r) }] : []),
  ];
}
