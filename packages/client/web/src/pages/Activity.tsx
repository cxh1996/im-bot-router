import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';
import { getOverview, type Overview } from '../api';
import { TxnLog } from '../components/TxnLog';
import { registerPanel } from '../slots';

function ActivityPage() {
  const { message } = App.useApp();
  const [ov, setOv] = useState<Overview | null>(null);
  const refresh = useCallback(() => {
    getOverview().then(setOv).catch((e: Error) => {
      if (e.message !== 'unauthorized') message.error('加载失败');
    });
  }, [message]);
  useEffect(refresh, [refresh]);

  const botName = (id: string) => {
    const bot = ov?.bots.find((b) => b.id === id);
    return bot ? bot.name : id;
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>事务</h2>
          <p className="lede">一条事务属于收到它的那个回调服务，再落到该服务下的某一个机器人。先按通道筛，再按机器人看。</p>
        </div>
      </div>
      <TxnLog
        services={ov?.services ?? []}
        bots={ov?.bots ?? []}
        botName={botName}
      />
    </div>
  );
}

registerPanel({ id: 'activity', label: '事务', order: 30, component: ActivityPage });
