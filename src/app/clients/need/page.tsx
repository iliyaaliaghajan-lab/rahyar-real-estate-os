'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import type { NeedInput } from '@/types';
import { Button, EmptyState, ListSkeleton, PageHeader } from '@/components/ui';
import { NeedForm } from '@/features/clients/NeedForm';

function NeedPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const needId = sp.get('id');
  const paramClient = sp.get('clientId') ?? '';
  const need = useQuery(async () => (needId ? (await repositories.needs.get(needId)) ?? null : null), [needId]);
  const clientId = needId ? (need ? need.clientId : '') : paramClient;
  const client = useQuery(async () => (clientId ? (await repositories.clients.get(clientId)) ?? null : null), [clientId]);

  if ((needId && need === undefined) || client === undefined) return <ListSkeleton />;
  if (!client) return <div className="p-4"><EmptyState title="مشتری پیدا نشد" action={<Button href="/clients/">بازگشت</Button>} /></div>;
  const back = `/clients/view/?id=${encodeURIComponent(client.id)}`;
  const initial: NeedInput = need
    ? (({ id: _i, createdAt: _c, updatedAt: _u, ...rest }) => rest)(need)
    : { clientId: client.id, transactionType: 'rent', propertyType: null, minArea: null, maxArea: null, bedrooms: null, location: '', maxPrice: null, maxDeposit: null, maxRent: null, notes: '' };
  return (
    <>
      <PageHeader title={need ? 'ویرایش نیاز' : 'ثبت نیاز'} subtitle={client.name} back={back} />
      <div className="px-4 pb-6">
        <NeedForm initial={initial} submitLabel={need ? 'ذخیره تغییرات' : 'ذخیره نیاز'} onCancel={() => router.push(back)}
          onSubmit={async (n) => { if (need) await repositories.needs.update(need.id, n); else await repositories.needs.create(n); router.push(back); }} />
      </div>
    </>
  );
}
export default function Page() { return <Suspense fallback={<ListSkeleton />}><NeedPage /></Suspense>; }
