'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { repositories } from '@/lib/repositories';
import { useQuery } from '@/lib/repositories/hooks';
import { formatNumberFa } from '@/lib/utils/persian';
import { Badge, Card, EmptyState, Input, ListSkeleton, PageHeader, Section } from '@/components/ui';
import { PropertyCard } from '@/features/properties/PropertyCard';

function Search() {
  const [q, setQ] = useState(useSearchParams().get('q') ?? '');
  const props = useQuery(() => repositories.properties.search(q), [q]);
  const clients = useQuery(() => repositories.clients.search(q), [q]);
  const empty = q.trim() && props && clients && props.length === 0 && clients.length === 0;
  return (
    <>
      <PageHeader title="جستجو" back="/more/" />
      <div className="px-4"><Input type="search" autoFocus placeholder="فایل یا مشتری را جستجو کنید…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجو" /></div>
      {!q.trim() ? <div className="p-4"><EmptyState title="عبارتی بنویسید" hint="جستجو در عنوان، منطقه، توضیحات، نام و شماره تلفن انجام می‌شود." /></div>
        : !props || !clients ? <ListSkeleton /> : empty ? <div className="p-4"><EmptyState title="نتیجه‌ای پیدا نشد" /></div> : (
        <>
          {props.length > 0 && <Section title={`فایل‌ها (${formatNumberFa(props.length)})`}><div className="space-y-3">{props.map((p) => <PropertyCard key={p.id} property={p} />)}</div></Section>}
          {clients.length > 0 && <Section title={`مشتریان (${formatNumberFa(clients.length)})`}><div className="space-y-3">{clients.map((c) => (
            <Link key={c.id} href={`/clients/view/?id=${encodeURIComponent(c.id)}`} className="block"><Card className="p-4"><p className="font-semibold">{c.name}</p>{c.tags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}</Card></Link>))}</div></Section>}
        </>
      )}
    </>
  );
}
export default function Page() { return <Suspense fallback={<ListSkeleton />}><Search /></Suspense>; }
