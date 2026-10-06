export type TransactionType = 'sale' | 'rent';
export type PropertyType = 'apartment' | 'house' | 'land' | 'shop' | 'office' | 'other';
export type FollowUpStatus = 'pending' | 'completed';

/** Money is always stored as integer TOMAN. Unknown numbers are null, unknown text is ''. */
export interface Property {
  id: string;
  title: string;
  transactionType: TransactionType;
  propertyType: PropertyType;
  area: number | null;
  bedrooms: number | null;
  location: string;
  neighborhood: string;
  price: number | null;
  deposit: number | null;
  rent: number | null;
  floor: number | null;
  totalFloors: number | null;
  parking: boolean | null;
  elevator: boolean | null;
  storage: boolean | null;
  description: string;
  contactName: string;
  contactPhone: string;
  createdAt: number;
  updatedAt: number;
}
export type PropertyInput = Omit<Property, 'id' | 'createdAt' | 'updatedAt'>;
/** A draft may not have the two required enums yet (e.g. parser could not tell). */
export type PropertyDraft = Omit<PropertyInput, 'transactionType' | 'propertyType'> & {
  transactionType: TransactionType | null;
  propertyType: PropertyType | null;
};

export interface Client {
  id: string;
  name: string;
  phone: string;
  notes: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
export type ClientInput = Omit<Client, 'id' | 'createdAt' | 'updatedAt'>;

export interface Need {
  id: string;
  clientId: string;
  transactionType: TransactionType;
  propertyType: PropertyType | null; // null = any
  minArea: number | null;
  maxArea: number | null;
  bedrooms: number | null;
  location: string;
  maxPrice: number | null;
  maxDeposit: number | null;
  maxRent: number | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
}
export type NeedInput = Omit<Need, 'id' | 'createdAt' | 'updatedAt'>;

export interface FollowUp {
  id: string;
  title: string;
  clientId: string;
  propertyId: string | null;
  dueDate: string; // local calendar date YYYY-MM-DD
  status: FollowUpStatus;
  notes: string;
  createdAt: number;
  updatedAt: number;
}
export type FollowUpInput = Omit<FollowUp, 'id' | 'createdAt' | 'updatedAt'>;

export interface Activity {
  id: string;
  type: 'property' | 'client' | 'need' | 'followup';
  text: string;
  createdAt: number;
}
