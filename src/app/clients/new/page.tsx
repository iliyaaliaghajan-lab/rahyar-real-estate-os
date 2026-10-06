'use client';
import { useRouter } from 'next/navigation';
import { repositories } from '@/lib/repositories';
import { PageHeader } from '@/components/ui';
import { ClientForm } from '@/features/clients/ClientForm';

export default function NewClient() {
  const router = useRouter();
  return (
    <>
      <PageHeader title="ثبت مشتری" back="/clients/" />
      <div className="px-4 pb-6">
        <ClientForm submitLabel="ذخیره مشتری" onCancel={() => router.push('/clients/')}
          onSubmit={async (c) => { const row = await repositories.clients.create(c); router.push(`/clients/view/?id=${encodeURIComponent(row.id)}`); }} />
      </div>
    </>
  );
}
