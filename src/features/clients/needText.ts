import type { Need } from '@/types';
import { formatNumberFa, formatToman } from '@/lib/utils/persian';
import { PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from '@/lib/utils/labels';

/** Short chips describing a need, using only fields the client actually specified. */
export function needChips(n: Need): string[] {
  const chips = [TRANSACTION_LABELS[n.transactionType], n.propertyType ? PROPERTY_TYPE_LABELS[n.propertyType] : 'هر نوع ملک'];
  if (n.minArea != null || n.maxArea != null) {
    chips.push(n.minArea != null && n.maxArea != null ? `${formatNumberFa(n.minArea)} تا ${formatNumberFa(n.maxArea)} متر`
      : n.minArea != null ? `حداقل ${formatNumberFa(n.minArea)} متر` : `حداکثر ${formatNumberFa(n.maxArea as number)} متر`);
  }
  if (n.bedrooms != null) chips.push(`${formatNumberFa(n.bedrooms)} خواب`);
  if (n.location) chips.push(n.location);
  if (n.maxPrice != null) chips.push(`سقف ${formatToman(n.maxPrice)}`);
  if (n.maxDeposit != null) chips.push(`رهن تا ${formatToman(n.maxDeposit)}`);
  if (n.maxRent != null) chips.push(`اجاره تا ${formatToman(n.maxRent)}`);
  return chips;
}
