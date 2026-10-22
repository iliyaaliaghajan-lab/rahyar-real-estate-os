'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button, Card, Callout, PageHeader } from '@/components/ui';

function AcceptInviteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams]);

  const [status, setStatus] = useState<'checking' | 'need_login' | 'working' | 'done' | 'error'>(
    'checking',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!token || token.length < 32) {
        setStatus('error');
        setMessage('لینک دعوت نامعتبر است.');
        return;
      }

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) setStatus('need_login');
        return;
      }

      if (!cancelled) setStatus('working');

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
  }, [token]);

  function goLogin() {
    const next = `/invite/accept?token=${encodeURIComponent(token)}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
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
                برای پذیرش دعوت باید با همان ایمیل دعوت‌شده وارد شوید.
              </Callout>
              <Button className="w-full" onClick={goLogin}>
                ورود و بازگشت به دعوت
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
