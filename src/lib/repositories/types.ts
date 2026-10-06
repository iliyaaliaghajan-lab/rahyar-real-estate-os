import type {
  Activity, Client, ClientInput, FollowUp, FollowUpInput, Need, NeedInput, Property, PropertyInput,
} from '../../types';

/** Storage-agnostic contracts. A future HTTP/Postgres backend implements the same interfaces. */
export interface PropertyRepository {
  list(): Promise<Property[]>;
  get(id: string): Promise<Property | undefined>;
  create(input: PropertyInput): Promise<Property>;
  update(id: string, patch: Partial<PropertyInput>): Promise<Property>;
  remove(id: string): Promise<void>;
  search(query: string): Promise<Property[]>;
}
export interface ClientRepository {
  list(): Promise<Client[]>;
  get(id: string): Promise<Client | undefined>;
  create(input: ClientInput): Promise<Client>;
  update(id: string, patch: Partial<ClientInput>): Promise<Client>;
  /** Cascades: removes the client's needs and follow-ups. */
  remove(id: string): Promise<void>;
  search(query: string): Promise<Client[]>;
}
export interface NeedRepository {
  list(): Promise<Need[]>;
  listByClient(clientId: string): Promise<Need[]>;
  get(id: string): Promise<Need | undefined>;
  create(input: NeedInput): Promise<Need>;
  update(id: string, patch: Partial<NeedInput>): Promise<Need>;
  remove(id: string): Promise<void>;
}
export interface FollowUpRepository {
  list(): Promise<FollowUp[]>;
  listByClient(clientId: string): Promise<FollowUp[]>;
  get(id: string): Promise<FollowUp | undefined>;
  create(input: FollowUpInput): Promise<FollowUp>;
  update(id: string, patch: Partial<FollowUpInput>): Promise<FollowUp>;
  setStatus(id: string, status: FollowUp['status']): Promise<FollowUp>;
  remove(id: string): Promise<void>;
}
export interface ActivityRepository {
  log(type: Activity['type'], text: string): Promise<void>;
  recent(limit: number): Promise<Activity[]>;
}
export interface Repositories {
  properties: PropertyRepository;
  clients: ClientRepository;
  needs: NeedRepository;
  followUps: FollowUpRepository;
  activities: ActivityRepository;
}
