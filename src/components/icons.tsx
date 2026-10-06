import type { SVGProps } from 'react';

const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
type P = SVGProps<SVGSVGElement>;

export const HomeIcon = (p: P) => <svg {...base} {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>;
export const BuildingIcon = (p: P) => <svg {...base} {...p}><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 21v-4h4v4" /></svg>;
export const UsersIcon = (p: P) => <svg {...base} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.3 3.1-5 6.5-5s5.9 1.7 6.5 5" /><path d="M16 4.7a3.5 3.5 0 010 6.6M18 15.3c1.9.7 3 2.3 3.5 4.7" /></svg>;
export const SparkleIcon = (p: P) => <svg {...base} {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /><path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16z" /></svg>;
export const BellIcon = (p: P) => <svg {...base} {...p}><path d="M6 17V11a6 6 0 1112 0v6l1.5 2h-15L6 17z" /><path d="M10 21a2 2 0 004 0" /></svg>;
export const MoreIcon = (p: P) => <svg {...base} {...p}><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg>;
export const PlusIcon = (p: P) => <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const SearchIcon = (p: P) => <svg {...base} {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></svg>;
export const CheckIcon = (p: P) => <svg {...base} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
export const XIcon = (p: P) => <svg {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const PhoneIcon = (p: P) => <svg {...base} {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>;
export const ChevronIcon = (p: P) => <svg {...base} {...p}><path d="M15 6l-6 6 6 6" /></svg>;
