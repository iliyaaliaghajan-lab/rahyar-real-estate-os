import type { PropertyType, TransactionType } from '../../types';

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  sale: 'فروش',
  rent: 'رهن و اجاره',
};
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: 'آپارتمان',
  house: 'خانه',
  land: 'زمین',
  shop: 'مغازه',
  office: 'دفتر',
  other: 'سایر',
};
export const PROPERTY_TYPES = Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[];
