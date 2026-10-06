'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { formatJalali, relativeDayLabel } from '@/lib/utils/date';
import { Badge, Button, Card, EmptyState, ListSkeleton, PageHeader, Section } from '@/components/ui';
import { PhoneIcon, PlusIcon } from '@/components/icons';
import { needChips } from '@/features/clients/needText';
import { NeedMatches } from '@/features/matching/NeedMatches';

function View() {
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const client = useQuery(async () => (id ? (await repositories.clients.get(id)) ?? null : null), [id]);
  const needs = useQuery(() => (id ? repositories.needs.listByClient(id) : Promise.resolve([])), [id]);
  const followUps = useQuery(() => (id ? repositories.followUps.listByClient(id) : Promise.resolve([])), [id]);

  if (client === undefined) return <ListSkeleton />;
  if (client === null) return <div className="p-4"><EmptyState title="مشتری پیدا نشد" action={<Button href="/clients/">بازگشت به مشتریان</Button>} /></div>;

  async function removeClient() {
    if (!client || !window.confirm('این مشتری با همه نیازها و پیگیری‌هایش حذف شود؟')) return;
    await repositories.clients.remove(client.id);
    router.replace('/clients/');
  }
  async function removeNeed(nid: string) {
    if (window.confirm('این نیاز حذف شود؟')) await repositories.needs.remove(nid);
  }

  return (
    <>
      <PageHeader title={client.name} back="/clients/"
        action={client.phone ? <Button href={`tel:${client.phone}`} variant="secondary" size="sm"><PhoneIcon width={16} height={16} /> تماس</Button> : undefined} />
      {(client.tags.length > 0 || client.notes) && (
        <Section>
          <Card className="space-y-2 p-4">
            {client.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{client.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
            {client.notes && <p className="whitespace-pre-wrap text-sm leading-7">{client.notes}</p>}
          </Card>
        </Section>
      )}
      <Section title="نیازهای مشتری" action={<Button size="sm" variant="ghost" href={`/clients/need/?clientId=${encodeURIComponent(client.id)}`}><PlusIcon width={16} height={16} /> ثبت نیاز</Button>}>
        {!needs ? <ListSkeleton rows={1} /> : needs.length === 0
          ? <EmptyState title="هنوز نیازی ثبت نشده" hint="با ثبت نیاز، رهیار فایل‌های مناسب را پیدا می‌کند." action={<Button href={`/clients/need/?clientId=${encodeURIComponent(client.id)}`}>ثبت نیاز</Button>} />
          : <div className="space-y-4">{needs.map((n) => (
              <Card key={n.id} className="space-y-3 p-4">
                <div className="flex flex-wrap gap-1.5">{needChips(n).map((c, i) => <Badge key={i} tone={i === 0 ? 'brand' : 'slate'}>{c}</Badge>)}</div>
                {n.notes && <p className="text-sm text-slate-600">{n.notes}</p>}
                <NeedMatches need={n} client={client} />
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" href={`/clients/need/?id=${encodeURIComponent(n.id)}`}>ویرایش نیاز</Button>
                  <Button size="sm" variant="danger" onClick={() => removeNeed(n.id)}>حذف</Button>
                </div>
              </Card>
            ))}</div>}
      </Section>
      <Section title="پیگیری‌ها" action={<Button size="sm" variant="ghost" href={`/followups/new/?clientId=${encodeURIComponent(client.id)}`}><PlusIcon width={16} height={16} /> پیگیری</Button>}>
        {!followUps || followUps.length === 0 ? <p className="text-sm text-slate-500">پیگیری‌ای ثبت نشده.</p>
          : <Card className="divide-y divide-slate-100">{followUps.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className={f.status === 'completed' ? 'text-slate-400 line-through' : ''}>{f.title}</span>
                <span className="shrink-0 text-xs text-slate-500">{f.status === 'completed' ? 'انجام شد' : relativeDayLabel(f.dueDate)} • {formatJalali(f.dueDate)}</span>
              </div>))}</Card>}
      </Section>
      <div className="flex gap-2 px-4 py-4">
        <Button href={`/clients/edit/?id=${encodeURIComponent(client.id)}`} variant="secondary" className="flex-1">ویرایش مشتری</Button>
        <Button variant="danger" onClick={removeClient}>حذف</Button>
      </div>
    </>
  );
}
export default function Page() { return <Suspense fallback={<ListSkeleton />}><View /></Suspense>; }
