'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { Button, EmptyState, ListSkeleton, PageHeader } from '@/components/ui';
import { ClientForm } from '@/features/clients/ClientForm';

function Edit() {
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const c = useQuery(async () => (id ? (await repositories.clients.get(id)) ?? null : null), [id]);
  if (c === undefined) return <ListSkeleton />;
  if (c === null) return <div className="p-4"><EmptyState title="مشتری پیدا نشد" action={<Button href="/clients/">بازگشت</Button>} /></div>;
  const back = `/clients/view/?id=${encodeURIComponent(c.id)}`;
  return (
    <>
      <PageHeader title="ویرایش مشتری" back={back} />
      <div className="px-4 pb-6">
        <ClientForm initial={c} submitLabel="ذخیره تغییرات" onCancel={() => router.push(back)}
          onSubmit={async (v) => { await repositories.clients.update(c.id, v); router.push(back); }} />
      </div>
    </>
  );
}
export default function Page() { return <Suspense fallback={<ListSkeleton />}><Edit /></Suspense>; }
