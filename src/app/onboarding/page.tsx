'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button, Card, Callout, Field, Input, PageHeader } from '@/components/ui';

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Simple auth check on mount
  useEffect(() => {
    const check = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setChecking(false);
    };
    check();
  }, [router]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.replace('/login');
      return;
    }

    // 1. Create the organization
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name: name.trim() })
      .select('id')
      .single();

    if (orgError || !org) {
      setLoading(false);
      setError(orgError?.message || 'خطا در ایجاد مجموعه. لطفاً دوباره تلاش کنید.');
      return;
    }

    // 2. Add current user as owner
    const { error: memberError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: user.id,
        role: 'owner',
        status: 'active',
        joined_at: new Date().toISOString(),
      });

    setLoading(false);

    if (memberError) {
      setError(memberError.message || 'مجموعه ایجاد شد اما عضویت ثبت نشد. با پشتیبانی تماس بگیرید.');
      return;
    }

    // Success → go to home
    router.replace('/');
  }

  if (checking) {
    return (
      <>
        <PageHeader title="راه‌اندازی مجموعه" />
        <div className="px-4 py-8 text-center text-sm text-slate-500">در حال بررسی...</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="ایجاد مجموعه"
        subtitle="اولین قدم برای حساب مادر"
      />

      <div className="px-4 pb-8">
        <Card className="p-5">
          <p className="mb-4 text-sm leading-7 text-slate-600">
            نام آژانس یا مجموعه خود را وارد کنید. شما به عنوان <strong>مالک</strong> این مجموعه ثبت می‌شوید و می‌توانید بعداً همکاران را دعوت کنید.
          </p>

          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="نام مجموعه" hint="مثلاً: املاک آفتاب، گروه مسکن پارس">
              <Input
                required
                placeholder="نام آژانس یا شرکت"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </Field>

            {error && (
              <Callout tone="error">{error}</Callout>
            )}

            <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
              {loading ? 'در حال ایجاد...' : 'ایجاد مجموعه و ادامه'}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
