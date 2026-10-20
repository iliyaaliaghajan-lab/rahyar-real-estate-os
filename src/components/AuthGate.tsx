'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getCurrentMembership } from '@/lib/auth/organization';

type AuthGateProps = {
  children: ReactNode;
  /** If true, user must be logged in */
  requireAuth?: boolean;
  /** If true, user must have an active organization */
  requireOrganization?: boolean;
  /** Where to send unauthenticated users */
  loginPath?: string;
  /** Where to send users without an organization */
  onboardingPath?: string;
};

/**
 * Smart gate for authentication and organization membership.
 *
 * - requireAuth: redirects to login if not signed in
 * - requireOrganization: redirects to onboarding if signed in but has no org
 * - On /onboarding: if user already has an org → redirect to home
 */
export function AuthGate({
  children,
  requireAuth = false,
  requireOrganization = false,
  loginPath = '/login',
  onboardingPath = '/onboarding',
}: AuthGateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      // Not logged in
      if (!user) {
        if (requireAuth || requireOrganization) {
          router.replace(loginPath);
          return;
        }
        if (!cancelled) setReady(true);
        return;
      }

      // Logged in → check membership
      const membership = await getCurrentMembership();

      // Already has organization but is on onboarding page → go home
      if (membership && pathname?.startsWith('/onboarding')) {
        router.replace('/');
        return;
      }

      // Needs organization but doesn't have one
      if (requireOrganization && !membership) {
        router.replace(onboardingPath);
        return;
      }

      if (!cancelled) setReady(true);
    }

    check();
    return () => { cancelled = true; };
  }, [requireAuth, requireOrganization, loginPath, onboardingPath, pathname, router]);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        در حال بررسی...
      </div>
    );
  }

  return <>{children}</>;
}
