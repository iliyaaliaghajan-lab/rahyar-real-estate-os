'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import type { PropertyDraft } from '@/types';
import { Button, EmptyState, ListSkeleton, PageHeader } from '@/components/ui';
import { PropertyForm } from '@/features/properties/PropertyForm';

function Edit() {
  const router = useRouter();
  const id = useSearchParams().get('id') ?? '';
  const p = useQuery(async () => (id ? (await repositories.properties.get(id)) ?? null : null), [id]);
  if (p === undefined) return <ListSkeleton />;
  if (p === null) return <div className="p-4"><EmptyState title="فایل پیدا نشد" action={<Button href="/properties/">بازگشت به فایل‌ها</Button>} /></div>;
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = p;
  const initial: PropertyDraft = rest;
  const back = `/properties/view/?id=${encodeURIComponent(p.id)}`;
  return (
    <>
      <PageHeader title="ویرایش فایل" back={back} />
      <div className="px-4 pb-6">
        <PropertyForm initial={initial} submitLabel="ذخیره تغییرات" onCancel={() => router.push(back)}
          onSubmit={async (input) => { await repositories.properties.update(p.id, input); router.push(back); }} />
      </div>
    </>
  );
}
export default function Page() { return <Suspense fallback={<ListSkeleton />}><Edit /></Suspense>; }
