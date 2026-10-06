'use client';
import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { findMatchesForProperty } from '@/lib/matching';
import { formatNumberFa, formatToman } from '@/lib/utils/persian';
import { formatJalali } from '@/lib/utils/date';
import { PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '@/lib/utils/labels';
import { Badge, Button, Card, EmptyState, ListSkeleton, PageHeader, Section } from '@/components/ui';
import { PhoneIcon } from '@/components/icons';
import { MatchCard } from '@/features/matching/MatchCard';

const yesNo = (v: boolean | null) => (v == null ? 'نامشخص' : v ? 'دارد' : 'ندارد');

function View() {
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const p = useQuery(async () => (id ? (await repositories.properties.get(id)) ?? null : null), [id]);
  const needs = useQuery(() => repositories.needs.list());
  const clients = useQuery(() => repositories.clients.list());
  const matches = useMemo(() => (p && needs ? findMatchesForProperty(p, needs, 40) : []), [p, needs]);

  if (p === undefined) return <ListSkeleton />;
  if (p === null) return <div className="p-4"><EmptyState title="فایل پیدا نشد" action={<Button href="/properties/">بازگشت به فایل‌ها</Button>} /></div>;

  const rows: Array<[string, string]> = [
    ['نوع ملک', PROPERTY_TYPE_LABELS[p.propertyType]],
    ['متراژ', p.area != null ? `${formatNumberFa(p.area)} متر` : 'نامشخص'],
    ['تعداد خواب', p.bedrooms != null ? formatNumberFa(p.bedrooms) : 'نامشخص'],
    ['منطقه', p.location || 'نامشخص'],
    ...(p.neighborhood ? [['توضیح محله', p.neighborhood] as [string, string]] : []),
    ...(p.transactionType === 'sale'
      ? [['قیمت', p.price != null ? formatToman(p.price) : 'نامشخص'] as [string, string]]
      : [['رهن', p.deposit != null ? formatToman(p.deposit) : 'نامشخص'] as [string, string], ['اجاره', p.rent != null ? formatToman(p.rent) : 'نامشخص'] as [string, string]]),
    ['طبقه', p.floor != null ? `${formatNumberFa(p.floor)}${p.totalFloors != null ? ` از ${formatNumberFa(p.totalFloors)}` : ''}` : 'نامشخص'],
    ['پارکینگ', yesNo(p.parking)], ['آسانسور', yesNo(p.elevator)], ['انباری', yesNo(p.storage)],
    ['ثبت', formatJalali(p.createdAt)],
  ];
  const clientName = (cid: string) => clients?.find((c) => c.id === cid)?.name ?? 'مشتری';

  async function remove() {
    if (!p || !window.confirm('این فایل حذف شود؟ این کار قابل بازگشت نیست.')) return;
    await repositories.properties.remove(p.id);
    router.replace('/properties/');
  }

  return (
    <>
      <PageHeader title={p.title} back="/properties/" action={<Badge tone={p.transactionType === 'sale' ? 'amber' : 'brand'}>{TRANSACTION_LABELS[p.transactionType]}</Badge>} />
      <Section>
        <Card className="divide-y divide-slate-100">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm"><span className="text-slate-500">{k}</span><span className="font-medium">{v}</span></div>
          ))}
        </Card>
      </Section>
      {(p.contactName || p.contactPhone) && (
        <Section title="تماس">
          <Card className="flex items-center justify-between p-4">
            <span className="text-sm">{p.contactName || 'بدون نام'}</span>
            {p.contactPhone && <Button href={`tel:${p.contactPhone}`} variant="secondary" size="sm"><PhoneIcon width={16} height={16} /> تماس</Button>}
          </Card>
        </Section>
      )}
      {p.description && <Section title="توضیحات"><Card className="whitespace-pre-wrap p-4 text-sm leading-7">{p.description}</Card></Section>}
      <Section title="مشتریان مناسب این فایل">
        {!needs ? <ListSkeleton rows={1} /> : matches.length === 0
          ? <EmptyState title="نیازی با این فایل هم‌خوان نیست" hint="هر نیازی که قیدهای اصلی‌اش (نوع معامله، نوع ملک، متراژ، بودجه) رد نشود در اینجا می‌آید." />
          : <div className="space-y-3">{matches.map((m) => {
              const need = needs.find((n) => n.id === m.needId);
              return (
                <MatchCard key={m.needId} result={m} title={need ? clientName(need.clientId) : 'مشتری'} href={need ? `/clients/view/?id=${encodeURIComponent(need.clientId)}` : undefined}>
                  {need && <Button size="sm" variant="secondary" href={`/followups/new/?clientId=${encodeURIComponent(need.clientId)}&propertyId=${encodeURIComponent(p.id)}`}>ایجاد پیگیری</Button>}
                </MatchCard>
              );
            })}</div>}
      </Section>
      <div className="flex gap-2 px-4 py-4">
        <Button href={`/properties/edit/?id=${encodeURIComponent(p.id)}`} variant="secondary" className="flex-1">ویرایش</Button>
        <Button variant="danger" onClick={remove}>حذف</Button>
      </div>
    </>
  );
}
export default function Page() { return <Suspense fallback={<ListSkeleton />}><View /></Suspense>; }
