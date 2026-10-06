'use client';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ensureSeeded } from '@/lib/db/seed';
import { Callout } from './ui';

/** Opens IndexedDB and loads demo data on first launch before rendering pages. */
export function SeedGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    ensureSeeded().then(() => setState('ready')).catch(() => setState('error'));
  }, []);
  if (state === 'error') {
    return (
      <div className="p-4">
        <Callout tone="error" title="دسترسی به حافظه مرورگر ممکن نیست">
          رهیار برای ذخیره‌سازی از IndexedDB استفاده می‌کند. اگر در حالت ناشناس هستید، مرورگر را در حالت عادی باز کنید.
        </Callout>
      </div>
    );
  }
  if (state === 'loading') return <div className="p-4 text-sm text-slate-500">در حال آماده‌سازی…</div>;
  return <>{children}</>;
}
