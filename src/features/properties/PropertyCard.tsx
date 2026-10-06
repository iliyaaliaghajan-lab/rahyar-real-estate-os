import Link from 'next/link';
import type { Property } from '@/types';
import { formatNumberFa, formatToman } from '@/lib/utils/persian';
import { PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '@/lib/utils/labels';
import { Badge, Card } from '@/components/ui';

export function priceLine(p: Pick<Property, 'transactionType' | 'price' | 'deposit' | 'rent'>): string {
  if (p.transactionType === 'sale') return p.price != null ? `قیمت ${formatToman(p.price)}` : 'قیمت ثبت نشده';
  const parts: string[] = [];
  if (p.deposit != null) parts.push(`رهن ${formatToman(p.deposit)}`);
  if (p.rent != null) parts.push(`اجاره ${formatToman(p.rent)}`);
  return parts.length ? parts.join(' • ') : 'مبلغ ثبت نشده';
}

export function PropertyCard({ property: p }: { property: Property }) {
  const meta = [
    p.area != null ? `${formatNumberFa(p.area)} متر` : null,
    p.bedrooms != null ? `${formatNumberFa(p.bedrooms)} خواب` : null,
    p.location || null,
  ].filter(Boolean).join(' • ');
  return (
    <Link href={`/properties/view/?id=${encodeURIComponent(p.id)}`} className="block">
      <Card className="p-4 transition-colors hover:border-brand-200">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate font-semibold">{p.title}</h3>
          <Badge tone={p.transactionType === 'sale' ? 'amber' : 'brand'}>{TRANSACTION_LABELS[p.transactionType]}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">{PROPERTY_TYPE_LABELS[p.propertyType]}{meta ? ` • ${meta}` : ''}</p>
        <p className="mt-2 text-sm font-medium text-slate-800">{priceLine(p)}</p>
      </Card>
    </Link>
  );
}
