'use client';
import { useMemo, useState } from 'react';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { matchesQuery } from '@/lib/utils/search';
import { PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '@/lib/utils/labels';
import { formatNumberFa } from '@/lib/utils/persian';
import type { TransactionType } from '@/types';
import { Button, EmptyState, Input, ListSkeleton, PageHeader, cn } from '@/components/ui';
import { PlusIcon, SparkleIcon } from '@/components/icons';
import { PropertyCard } from '@/features/properties/PropertyCard';

export default function PropertiesPage() {
  const all = useQuery(() => repositories.properties.list());
  const [q, setQ] = useState('');
  const [tx, setTx] = useState<'all' | TransactionType>('all');
  const rows = useMemo(
    () => (all ?? []).filter((p) => (tx === 'all' || p.transactionType === tx) &&
      matchesQuery([p.title, p.location, p.neighborhood, p.description, p.contactName, p.contactPhone,
        TRANSACTION_LABELS[p.transactionType], PROPERTY_TYPE_LABELS[p.propertyType]], q)),
    [all, q, tx],
  );
  const tabs: Array<['all' | TransactionType, string]> = [['all', 'همه'], ['sale', 'فروش'], ['rent', 'رهن و اجاره']];
  return (
    <>
      <PageHeader title="فایل‌ها" subtitle={all ? `${formatNumberFa(all.length)} فایل` : undefined}
        action={<Button href="/properties/new/" size="sm"><PlusIcon width={16} height={16} /> ثبت فایل</Button>} />
      <div className="space-y-3 px-4">
        <Button href="/properties/new/?mode=smart" className="w-full"><SparkleIcon width={18} height={18} /> ثبت هوشمند فایل</Button>
        <Input type="search" placeholder="جستجو در فایل‌ها (منطقه، عنوان، تلفن…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجو در فایل‌ها" />
        <div className="flex gap-2" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tx === k} onClick={() => setTx(k)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-medium', tx === k ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 border border-slate-200')}>{label}</button>
          ))}
        </div>
      </div>
      {!all ? <ListSkeleton /> : (
        <div className="space-y-3 px-4 py-3">
          {rows.length === 0
            ? <EmptyState title={all.length === 0 ? 'هنوز فایلی ثبت نشده' : 'فایلی با این مشخصات پیدا نشد'} hint={all.length === 0 ? 'اولین فایل را با ورود هوشمند ثبت کنید.' : 'عبارت جستجو یا فیلتر را تغییر دهید.'}
                action={all.length === 0 ? <Button href="/properties/new/?mode=smart">ثبت هوشمند فایل</Button> : undefined} />
            : rows.map((p) => <PropertyCard key={p.id} property={p} />)}
        </div>
      )}
    </>
  );
}
