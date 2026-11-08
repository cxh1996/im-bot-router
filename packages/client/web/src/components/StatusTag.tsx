// 状态标签：中性灰底 + 语义色点（纯色现代风，弃 antd 彩色 Tag）
import { Tag } from 'antd';

const DOT: Record<string, string> = {
  success: '#52c41a',
  partial: '#faad14',
  failed: '#ff4d4f',
  dedup: '#597ef7',
  skipped: '#bfbfbf',
};

export function StatusTag({ value }: { value: string }) {
  return (
    <Tag bordered={false} style={{ background: '#fafafa', color: '#444', marginInlineEnd: 0 }}>
      <span className="dot" style={{ background: DOT[value] ?? '#bfbfbf' }} />
      {value}
    </Tag>
  );
}
