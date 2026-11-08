import { Tag } from 'antd';
import { STATUS_LABEL } from '../labels';

const DOT: Record<string, string> = {
  success: '#1f8a4c',
  partial: '#b7791f',
  failed: '#d14343',
  dedup: '#3d5a99',
  skipped: '#9a9a9a',
};

export function StatusTag({ value }: { value: string }) {
  return (
    <Tag bordered={false} className="status-tag" title={value}>
      <span className="dot" style={{ background: DOT[value] ?? '#9a9a9a' }} />
      {STATUS_LABEL[value] ?? value}
    </Tag>
  );
}
