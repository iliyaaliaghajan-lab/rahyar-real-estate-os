'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { matchesQuery } from '@/lib/utils/search';
import { formatNumberFa, toPersianDigits } from '@/lib/utils/persian';
import { Badge, Button, Card, EmptyState, Input, ListSkeleton, PageHeader } from '@/components/ui';
import { PlusIcon } from '@/components/icons';

export default function ClientsPage() {
  const clients = useQuery(() => repositories.clients.list());
  const needs = useQuery(() => repositories.needs.list());
  const [q, setQ] = useState('');
  const rows = useMemo(() => (clients ?? []).filter((c) => matchesQuery([c.name, c.phone, c.notes, ...c.tags], q)), [clients, q]);
  const needCount = (id: string) => (needs ?? []).filter((n) => n.clientId === id).length;
  return (
    <>
      <PageHeader title="مشتریان" subtitle={clients ? `${formatNumberFa(clients.length)} مشتری` : undefined}
        action={<Button href="/clients/new/" size="sm"><PlusIcon width={16} height={16} /> ثبت مشتری</Button>} />
      <div className="px-4"><Input type="search" placeholder="جستجو در مشتریان (نام، تلفن، برچسب…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجو در مشتریان" /></div>
      {!clients ? <ListSkeleton /> : (
        <div className="space-y-3 px-4 py-3">
          {rows.length === 0
            ? <EmptyState title={clients.length === 0 ? 'هنوز مشتری ثبت نشده' : 'مشتری‌ای پیدا نشد'} action={clients.length === 0 ? <Button href="/clients/new/">ثبت مشتری</Button> : undefined} />
            : rows.map((c) => (
              <Link key={c.id} href={`/clients/view/?id=${encodeURIComponent(c.id)}`} className="block">
                <Card className="p-4 transition-colors hover:border-brand-200">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate font-semibold">{c.name}</h3>
                    <span className="shrink-0 text-xs text-slate-500">{formatNumberFa(needCount(c.id))} نیاز</span>
                  </div>
                  {c.phone && <p className="mt-0.5 text-sm text-slate-500" dir="ltr" style={{ textAlign: 'right' }}>{toPersianDigits(c.phone)}</p>}
                  {c.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
                </Card>
              </Link>
            ))}
        </div>
      )}
    </>
  );
}
