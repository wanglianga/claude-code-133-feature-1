import { useCallback, useEffect, useState } from 'react';
import { App as AntApp } from 'antd';

export function useApi<T = any>(path: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const res = await fetch(`/api${path}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { reload(); }, [reload, ...deps]);
  return { data, loading, reload, setData };
}

export function useAction() {
  const { message } = AntApp.useApp();
  return async (fn: () => Promise<any>, okText = '操作成功') => {
    try {
      const r = await fn();
      message.success(okText);
      return r;
    } catch (e: any) {
      message.error(e.message || '操作失败');
      throw e;
    }
  };
}
