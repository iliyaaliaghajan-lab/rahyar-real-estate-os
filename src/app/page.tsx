'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { suggestTopMatches } from '@/lib/matching';
import { formatJalaliLong, relativeDayLabel, timeAgo, todayISO } from '@/lib/utils/date';
import { formatNumberFa, toPersianDigits } from '@/lib/utils/persian';
import { AuthGate } from '@/components/AuthGate';
import { Badge, Button, Card, EmptyState, ListSkeleton, PageHeader, Section } from '@/components/ui';
import { PlusIcon, SparkleIcon } from '@/components/icons';

function Stat({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Link href={href} className="block bg-white px-4 py-3 hover:bg-slate-50">
      <p className="text-2xl font-bold text-brand-700">{formatNumberFa(value)}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </Link>
  );
}

function DashboardContent() {
  const properties = useQuery(() => repositories.properties.list());
  const clients = useQuery(() => repositories.clients.list());
  const needs = useQuery(() => repositories.needs.list());
  const followUps = useQuery(() => repositories.followUps.list());
  const acts = useQuery(() => repositories.activities.recent(6));
  const today = todayISO();

  const suggestions = useMemo(() => (properties && needs ? suggestTopMatches(needs, properties) : []), [properties, needs]);
  const due = useMemo(() => (followUps ?? []).filter((f) => f.status === 'pending' && f.dueDate <= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [followUps, today]);
  const dueToday = due.filter((f) => f.dueDate === today).length;

  if (!properties || !clients || !needs || !followUps || !acts) return <><PageHeader title="اتحاد" /><ListSkeleton rows={4} /></>;
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? 'مشتری';

  return (
    <>
      <PageHeader title="اتحاد" subtitle={formatJalaliLong(new Date())} />
      <div className="space-y-2 px-4">
        <Button href="/properties/new/?mode=smart" className="w-full"><SparkleIcon width={18} height={18} /> ثبت هوشمند فایل</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button href="/properties/new/" variant="secondary"><PlusIcon width={16} height={16} /> ثبت فایل</Button>
          <Button href="/clients/new/" variant="secondary"><PlusIcon width={16} height={16} /> ثبت مشتری</Button>
        </div>
      </div>

      <Section>
        <Card className="grid grid-cols-2 gap-px overflow-hidden bg-slate-200 sm:grid-cols-3">
          <Stat href="/properties/" label="فایل‌ها" value={properties.length} />
          <Stat href="/clients/" label="مشتریان" value={clients.length} />
          <Stat href="/clients/" label="نیازها" value={needs.length} />
          <Stat href="/assistant/" label="تطبیق‌های پیشنهادی" value={suggestions.length} />
          <Stat href="/followups/" label="پیگیری‌های امروز" value={dueToday} />
        </Card>
      </Section>

      <Section title="پیگیری‌های امروز و عقب‌افتاده" action={<Link href="/followups/" className="text-xs text-brand-700">همه</Link>}>
        {due.length === 0 ? <EmptyState title="پیگیری فوری ندارید" hint="برای هر مشتری یک پیگیری ثبت کنید تا فراموش نشود." /> :
          <Card className="divide-y divide-slate-100">{due.slice(0, 5).map((f) => (
            <Link key={f.id} href="/followups/" className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-slate-50">
              <span className="min-w-0 truncate">{f.title}<span className="block text-xs text-slate-500">{clientName(f.clientId)}</span></span>
              <Badge tone={f.dueDate < today ? 'red' : 'amber'}>{f.dueDate < today ? relativeDayLabel(f.dueDate) : 'امروز'}</Badge>
            </Link>))}</Card>}
      </Section>

      <Section title="بهترین تطبیق‌ها">
        {suggestions.length === 0 ? <EmptyState title="هنوز تطبیقی پیدا نشده" hint="فایل و نیاز ثبت کنید تا رهیار فایل مناسب را پیشنهاد دهد." /> :
          <Card className="divide-y divide-slate-100">{suggestions.slice(0, 3).map((s) => (
            <Link key={s.need.id + s.property.id} href={`/clients/view/?id=${encodeURIComponent(s.need.clientId)}`} className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-slate-50">
              <span className="min-w-0 truncate">{clientName(s.need.clientId)}<span className="block truncate text-xs text-slate-500">{s.property.title}</span></span>
              <span className="shrink-0 text-end"><Badge tone="green">{toPersianDigits(s.result.score)}٪ تطابق</Badge><span className="mt-0.5 block text-[10px] text-slate-400">امتیاز مبتنی بر قوانین</span></span>
            </Link>))}</Card>}
      </Section>

      <Section title="فعالیت‌های اخیر">
        {acts.length === 0 ? <p className="text-sm text-slate-500">هنوز فعالیتی ثبت نشده.</p> :
          <Card className="divide-y divide-slate-100">{acts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="min-w-0 truncate">{a.text}</span><span className="shrink-0 text-xs text-slate-400">{timeAgo(a.createdAt)}</span></div>))}</Card>}
      </Section>
    </>
  );
}

export default function Dashboard() {
  return (
    <AuthGate requireOrganization>
      <DashboardContent />
    </AuthGate>
  );
}
