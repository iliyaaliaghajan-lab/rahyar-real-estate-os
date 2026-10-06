'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { addDaysISO, todayISO } from '@/lib/utils/date';
import { ListSkeleton, PageHeader } from '@/components/ui';
import { FollowUpForm } from '@/features/followups/FollowUpForm';

function New() {
  const router = useRouter();
  const sp = useSearchParams();
  const clients = useQuery(() => repositories.clients.list());
  const properties = useQuery(() => repositories.properties.list());
  if (!clients || !properties) return <ListSkeleton />;
  const clientId = clients.some((c) => c.id === sp.get('clientId')) ? (sp.get('clientId') as string) : '';
  const propertyId = properties.some((p) => p.id === sp.get('propertyId')) ? (sp.get('propertyId') as string) : null;
  const c = clients.find((x) => x.id === clientId);
  const p = properties.find((x) => x.id === propertyId);
  const title = sp.get('title') || (c && p ? `پیگیری فایل «${p.title}» برای ${c.name}` : c ? `پیگیری ${c.name}` : '');
  return (
    <>
      <PageHeader title="پیگیری جدید" back="/followups/" />
      <div className="px-4 pb-6">
        <FollowUpForm clients={clients} properties={properties} onCancel={() => router.back()}
          initial={{ title, clientId, propertyId, dueDate: addDaysISO(todayISO(), 1), status: 'pending', notes: '' }}
          onSubmit={async (f) => { await repositories.followUps.create(f); router.push('/followups/'); }} />
      </div>
    </>
  );
}
export default function Page() { return <Suspense fallback={<ListSkeleton />}><New /></Suspense>; }
