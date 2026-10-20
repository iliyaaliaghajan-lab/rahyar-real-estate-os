'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getCurrentMembership, type CurrentMembership } from '@/lib/auth/organization';

const ROLE_LABEL: Record<string, string> = {
  owner: 'مالک',
  admin: 'مدیر',
  agent: 'مشاور',
};

export function UserBar() {
  const router = useRouter();
  const [membership, setMembership] = useState<CurrentMembership | null | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await getCurrentMembership();
      if (!cancelled) setMembership(m);
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    setMembership(null);
    setLoggingOut(false);
    router.refresh();
  }

  // Still loading
  if (membership === undefined) {
    return (
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-center text-[11px] text-slate-400">
        در حال بارگذاری...
      </div>
    );
  }

  // Not logged in
  if (membership === null) {
    return (
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[12px]">
        <span className="text-slate-500">وارد نشده‌اید</span>
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          ورود
        </Link>
      </div>
    );
  }

  // Logged in with organization
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[12px]">
      <div className="min-w-0 truncate">
        <span className="font-medium text-slate-800">{membership.organizationName}</span>
        <span className="mx-1.5 text-slate-300">·</span>
        <span className="text-slate-500">{ROLE_LABEL[membership.role] ?? membership.role}</span>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={loggingOut}
        className="shrink-0 font-medium text-slate-500 hover:text-red-600 disabled:opacity-50"
      >
        {loggingOut ? '...' : 'خروج'}
      </button>
    </div>
  );
}
