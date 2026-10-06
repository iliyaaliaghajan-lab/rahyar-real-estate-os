'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { formatJalali, relativeDayLabel, todayISO } from '@/lib/utils/date';
import { formatNumberFa } from '@/lib/utils/persian';
import { Badge, Button, Card, EmptyState, ListSkeleton, PageHeader, cn } from '@/components/ui';
import { CheckIcon, PlusIcon } from '@/components/icons';

export default function FollowUpsPage() {
  const followUps = useQuery(() => repositories.followUps.list());
  const clients = useQuery(() => repositories.clients.list());
  const properties = useQuery(() => repositories.properties.list());
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const today = todayISO();
  const rows = useMemo(() => (followUps ?? []).filter((f) => f.status === tab).sort((a, b) => (tab === 'pending' ? a.dueDate.localeCompare(b.dueDate) : b.dueDate.localeCompare(a.dueDate))), [followUps, tab]);
  const pendingCount = (followUps ?? []).filter((f) => f.status === 'pending').length;

  return (
    <>
      <PageHeader title="پیگیری‌ها" subtitle={followUps ? `${formatNumberFa(pendingCount)} پیگیری باز` : undefined}
        action={<Button href="/followups/new/" size="sm"><PlusIcon width={16} height={16} /> پیگیری</Button>} />
      <div className="flex gap-2 px-4" role="tablist">
        {([['pending', 'در انتظار'], ['completed', 'انجام‌شده']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('rounded-full px-3 py-1.5 text-xs font-medium', tab === k ? 'bg-brand-600 text-white' : 'border border-slate-200 bg-white text-slate-600')}>{l}</button>
        ))}
      </div>
      {!followUps ? <ListSkeleton /> : (
        <div className="space-y-3 px-4 py-3">
          {rows.length === 0 ? <EmptyState title={tab === 'pending' ? 'پیگیری بازی ندارید' : 'هنوز پیگیری انجام‌شده‌ای نیست'} action={tab === 'pending' ? <Button href="/followups/new/">ایجاد پیگیری</Button> : undefined} /> :
            rows.map((f) => {
              const client = clients?.find((c) => c.id === f.clientId);
              const property = properties?.find((p) => p.id === f.propertyId);
              const overdue = f.status === 'pending' && f.dueDate < today;
              return (
                <Card key={f.id} className="flex items-start gap-3 p-4">
                  <button type="button" aria-label={f.status === 'pending' ? 'علامت‌گذاری به‌عنوان انجام‌شده' : 'بازگرداندن به در انتظار'}
                    onClick={() => repositories.followUps.setStatus(f.id, f.status === 'pending' ? 'completed' : 'pending')}
                    className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', f.status === 'completed' ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-transparent hover:border-brand-500')}>
                    <CheckIcon width={14} height={14} strokeWidth={3} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn('font-medium', f.status === 'completed' && 'text-slate-400 line-through')}>{f.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {client && <Link href={`/clients/view/?id=${encodeURIComponent(client.id)}`} className="hover:text-brand-700">{client.name}</Link>}
                      {property && <> • <Link href={`/properties/view/?id=${encodeURIComponent(property.id)}`} className="hover:text-brand-700">{property.title}</Link></>}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                      <Badge tone={overdue ? 'red' : f.dueDate === today ? 'amber' : 'slate'}>{overdue ? 'عقب‌افتاده' : relativeDayLabel(f.dueDate)}</Badge>
                      <span>{formatJalali(f.dueDate)}</span>
                    </div>
                  </div>
                  <button type="button" className="text-xs text-slate-400 hover:text-red-600" onClick={() => { if (window.confirm('این پیگیری حذف شود؟')) repositories.followUps.remove(f.id); }}>حذف</button>
                </Card>
              );
            })}
        </div>
      )}
    </>
  );
}
