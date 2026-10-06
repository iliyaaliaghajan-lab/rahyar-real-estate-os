'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { repositories } from '@/lib/repositories';
import { emptyDraft } from '@/lib/parser';
import { ListSkeleton, PageHeader, cn } from '@/components/ui';
import { PropertyForm } from '@/features/properties/PropertyForm';
import { SmartEntry } from '@/features/properties/SmartEntry';

function NewProperty() {
  const router = useRouter();
  const [mode, setMode] = useState<'smart' | 'manual'>(useSearchParams().get('mode') === 'smart' ? 'smart' : 'manual');
  const go = (id: string) => router.push(`/properties/view/?id=${encodeURIComponent(id)}`);
  return (
    <>
      <PageHeader title="ثبت فایل" back="/properties/" />
      <div className="space-y-4 px-4 pb-6">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/70 p-1" role="tablist">
          {([['smart', '✦ ورود هوشمند'], ['manual', 'ورود دستی']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              className={cn('rounded-lg py-2 text-sm font-medium', mode === k ? 'bg-white shadow-sm' : 'text-slate-600')}>{label}</button>
          ))}
        </div>
        {mode === 'smart'
          ? <SmartEntry onSaved={(p) => go(p.id)} />
          : <PropertyForm initial={emptyDraft()} submitLabel="ذخیره فایل" onSubmit={async (i) => go((await repositories.properties.create(i)).id)} />}
      </div>
    </>
  );
}
export default function Page() { return <Suspense fallback={<ListSkeleton />}><NewProperty /></Suspense>; }
