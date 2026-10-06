'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { BellIcon, BuildingIcon, HomeIcon, MoreIcon, SparkleIcon, UsersIcon } from './icons';
import { SeedGate } from './SeedGate';
import { ServiceWorkerRegister } from './ServiceWorkerRegister';
import { cn } from './ui';

const NAV = [
  { href: '/', label: 'خانه', Icon: HomeIcon },
  { href: '/properties/', label: 'فایل‌ها', Icon: BuildingIcon },
  { href: '/clients/', label: 'مشتریان', Icon: UsersIcon },
  { href: '/assistant/', label: 'دستیار', Icon: SparkleIcon },
  { href: '/followups/', label: 'پیگیری‌ها', Icon: BellIcon },
  { href: '/more/', label: 'بیشتر', Icon: MoreIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '/';
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href.replace(/\/$/, '')));
  return (
    <div className="mx-auto min-h-dvh max-w-3xl pb-28">
      <ServiceWorkerRegister />
      <SeedGate>{children}</SeedGate>
      <nav
        aria-label="ناوبری اصلی"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-6">
          {NAV.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px]', active ? 'text-brand-700' : 'text-slate-500')}
                >
                  <Icon width={22} height={22} strokeWidth={active ? 2.2 : 1.7} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
