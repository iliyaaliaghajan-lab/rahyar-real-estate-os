'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  hasLegacyTokenQuery,
  parseInviteTokenFromHash,
} from '@/lib/auth/inviteUrl';
import { Button, Card, Callout, PageHeader } from '@/components/ui';

type AcceptStatus =
  | 'checking'
  | 'need_login'
  | 'working'
  | 'done'
  | 'error'
  | 'legacy';

/**
 * Capture outcome of the one-time URL read. Survives React 18 Strict Mode
 * effect cleanup/replay without putting the token back into the URL or into
 * browser web storage APIs.
 */
type CaptureState =
  | { kind: 'unset' }
  | { kind: 'legacy' }
  | { kind: 'invalid'; reason: 'missing' | 'malformed' | 'too_short' | 'duplicate' }
  | { kind: 'ready'; token: string };

function AcceptInviteInner() {
  const router = useRouter();
  const [status, setStatus] = useState<AcceptStatus>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  // Component-local only — not persisted to browser storage.
  const captureRef = useRef<CaptureState>({ kind: 'unset' });

  useEffect(() => {
    let cancelled = false;

    // First effect run (or first run after mount): read URL once, clear it,
    // and stash the result in the ref so Strict Mode replay still has the token.
    if (captureRef.current.kind === 'unset') {
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const search = typeof window !== 'undefined' ? window.location.search : '';

      // Clear fragment + query before any network call; preserve Next history state.
      if (typeof window !== 'undefined') {
        const pathOnly = window.location.pathname;
        window.history.replaceState(window.history.state, '', pathOnly);
      }

      if (hasLegacyTokenQuery(search)) {
        captureRef.current = { kind: 'legacy' };
      } else {
        const parsed = parseInviteTokenFromHash(hash);
        if (!parsed.ok) {
          captureRef.current = { kind: 'invalid', reason: parsed.reason };
        } else {
          captureRef.current = { kind: 'ready', token: parsed.token };
        }
      }
    }

    const capture = captureRef.current;

    if (capture.kind === 'legacy') {
      setStatus('legacy');
      setMessage(
        'این لینک دعوت با قالب قدیمی ساخته شده است. لطفاً از دعوت‌کننده بخواهید لینک جدیدی ارسال کند.',
      );
      return () => {
        cancelled = true;
      };
    }

    if (capture.kind !== 'ready') {
      setStatus('error');
      if (capture.kind === 'invalid' && capture.reason === 'missing') {
        setMessage(
          'لینک دعوت یافت نشد. پس از ورود، لینک اصلی دعوت را از ایمیل یا پیام دعوت‌کننده دوباره باز کنید.',
        );
      } else {
        setMessage('لینک دعوت نامعتبر است.');
      }
      return () => {
        cancelled = true;
      };
    }

    // Token only in the ref + this closure — never re-inserted into a URL.
    const token = capture.token;

    async function run() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!user) {
        setStatus('need_login');
        return;
      }

      setStatus('working');

      const { data, error } = await supabase.rpc('accept_organization_invitation', {
        p_token: token,
      });

      if (cancelled) return;

      if (error) {
        setStatus('error');
        setMessage(error.message || 'پذیرش دعوت ناموفق بود.');
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      setOrgName(row?.organization_name ?? null);
      setStatus('done');
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  function goLogin() {
    // No token in next, query, or fragment — user must reopen the original invite link after login.
    router.replace('/login');
  }

  return (
    <>
      <PageHeader title="پذیرش دعوت" subtitle="عضویت در مجموعه" />
      <div className="px-4 pb-8">
        <Card className="p-5 space-y-4">
          {status === 'checking' && (
            <p className="text-sm text-slate-500">در حال بررسی لینک...</p>
          )}
          {status === 'working' && (
            <p className="text-sm text-slate-500">در حال ثبت عضویت...</p>
          )}
          {status === 'need_login' && (
            <>
              <Callout tone="error">
                برای پذیرش دعوت باید با همان ایمیل دعوت‌شده وارد شوید. پس از تکمیل ورود،{' '}
                <strong>همین لینک دعوت را دوباره باز کنید</strong> (لینک اصلی که برای شما ارسال
                شده است).
              </Callout>
              <Button className="w-full" onClick={goLogin}>
                ورود
              </Button>
            </>
          )}
          {status === 'done' && (
            <>
              <Callout tone="success">
                عضویت شما{orgName ? ` در «${orgName}»` : ''} فعال شد.
              </Callout>
              <Button className="w-full" onClick={() => router.replace('/')}>
                ورود به داشبورد
              </Button>
            </>
          )}
          {status === 'legacy' && (
            <>
              <Callout tone="error">{message}</Callout>
              <Button className="w-full" variant="secondary" onClick={() => router.replace('/')}>
                بازگشت
              </Button>
            </>
          )}
          {status === 'error' && (
            <>
              <Callout tone="error">{message}</Callout>
              <Button className="w-full" variant="secondary" onClick={() => router.replace('/')}>
                بازگشت
              </Button>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-8 text-center text-sm text-slate-500">بارگذاری...</div>
      }
    >
      <AcceptInviteInner />
    </Suspense>
  );
}
