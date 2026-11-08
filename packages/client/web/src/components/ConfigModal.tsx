import { Input, Modal } from 'antd';
import { useEffect, useState } from 'react';

export function ConfigModal({
  open,
  title,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initial: string;
  onClose: () => void;
  onSave: (value: Record<string, unknown>) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText(initial);
      setErr('');
    }
  }, [open, initial]);

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      confirmLoading={busy}
      destroyOnClose
      onOk={async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setErr('JSON 不合法');
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setErr('配置必须是 JSON 对象');
          return;
        }
        setBusy(true);
        try {
          await onSave(parsed as Record<string, unknown>);
          onClose();
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="hint">这份配置只作用于当前机器人上的这一次挂载。</p>
      <Input.TextArea
        className="mono"
        rows={12}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setErr('');
        }}
      />
      {err ? <div className="form-err">{err}</div> : null}
    </Modal>
  );
}
