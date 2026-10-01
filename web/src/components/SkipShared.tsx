import { Tag, Space, Timeline as AntTimeline, Typography } from 'antd';

export const SKIP_STATUS: Record<string, { text: string; color: string }> = {
  recorded: { text: '待站点确认', color: 'red' },
  station_confirmed: { text: '站点已确认·待调度', color: 'orange' },
  dispatch_reviewed: { text: '调度主管已复核', color: 'blue' },
  closed: { text: '已闭环', color: 'default' },
};

export function skipStatusTag(s: string) {
  const m = SKIP_STATUS[s] || { text: s, color: 'default' };
  return <Tag color={m.color}>{m.text}</Tag>;
}

export function complaintTag(s: string) {
  return ({
    none: <Tag>无投诉</Tag>,
    open: <Tag color="red">游客投诉待处理</Tag>,
    handling: <Tag color="orange">客服处理中</Tag>,
    closed: <Tag color="green">投诉已办结</Tag>,
  } as Record<string, JSX.Element>)[s] || <Tag>{s}</Tag>;
}

export function roleName(r: string) {
  return ({
    visitor: '游客', staff: '站点工作人员', station_manager: '站点负责人',
    driver: '司机', dispatch: '调度中心', dispatch_supervisor: '调度主管',
    service: '客服', service_supervisor: '客服主管', finance: '财务', system: '系统',
  } as Record<string, string>)[r] || r;
}

export function EtaText({ rec }: { rec: any }) {
  return (
    <Space wrap size={4}>
      <Typography.Text strong style={{ color: '#cf1322' }}>
        {rec.nextTripCode ? `下一班 ${rec.nextTripCode}` : '下一班（按计划间隔）'}
      </Typography.Text>
      <Tag color="red">预计 {rec.nextEtaMinutes} 分钟到达</Tag>
      {rec.nextEtaAt && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          约 {new Date(rec.nextEtaAt).toLocaleTimeString('zh-CN')}
        </Typography.Text>
      )}
    </Space>
  );
}

export function SkipRecordTimeline({ rec }: { rec: any }) {
  const tl: any[] = rec.timeline || [];
  return (
    <AntTimeline
      items={tl.map((t: any) => ({
        color: t.role === 'visitor' ? 'gold' : t.role === 'system' ? 'red' : 'green',
        children: (
          <div>
            <b>{roleName(t.role)}</b>
            <span style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>
              {new Date(t.at).toLocaleString('zh-CN')}
            </span>
            <div>{t.text}</div>
          </div>
        ),
      }))}
    />
  );
}
