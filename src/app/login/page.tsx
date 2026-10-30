'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { safeNextPath } from '@/lib/auth/inviteUrl';
import { Button, Card, Callout, Field, Input, PageHeader } from '@/components/ui';

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => safeNextPath(searchParams.get('next')), [searchParams]);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = createClient();
    // nextPath is already sanitized; it never carries an invitation token.
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    setLoading(false);

    if (error) {
      setMessage({
        type: 'error',
        text: error.message || 'خطا در ارسال لینک ورود. لطفاً دوباره تلاش کنید.',
      });
      return;
    }

    setMessage({
      type: 'success',
      text: 'لینک ورود به ایمیل شما ارسال شد. لطفاً صندوق ورودی خود را بررسی کنید.',
    });
  }

  return (
    <>
      <PageHeader title="ورود به اتحاد" subtitle="سیستم‌عامل همکاری املاک" />

      <div className="px-4 pb-8">
        <Card className="p-5">
          <form onSubmit={handleLogin} className="space-y-4">
            <Field label="ایمیل" hint="لینک ورود به این آدرس ارسال می‌شود">
              <Input
                type="email"
                required
                dir="ltr"
                className="text-left"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </Field>

            {message && (
              <Callout tone={message.type === 'success' ? 'success' : 'error'}>
                {message.text}
              </Callout>
            )}

            <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
              {loading ? 'در حال ارسال...' : 'ارسال لینک ورود'}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-500">
            با ورود، شرایط استفاده و حریم خصوصی را می‌پذیرید.
          </p>
        </Card>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="px-4 py-8 text-center text-sm text-slate-500">بارگذاری...</div>}>
      <LoginForm />
    </Suspense>
  );
}
