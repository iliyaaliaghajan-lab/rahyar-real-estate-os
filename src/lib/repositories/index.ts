import { dexieRepositories } from './dexieRepositories';
import type { Repositories } from './types';

/** The ONLY data entry point for the UI. Swap this object to move to a real backend. */
export const repositories: Repositories = dexieRepositories;
export type * from './types';
