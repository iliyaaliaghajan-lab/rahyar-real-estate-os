'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AuthGate } from '@/components/AuthGate';
import { Button, Card, Callout, Field, Input, PageHeader } from '@/components/ui';

function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);

    const supabase = createClient();

    // Atomic server-side creation: identity and role are fixed inside the function.
    // Client only supplies the organization name.
    const { data, error: rpcError } = await supabase.rpc('create_organization_with_owner', {
      p_name: name.trim(),
    });

    setLoading(false);

    if (rpcError) {
      setError(rpcError.message || 'خطا در ایجاد مجموعه. لطفاً دوباره تلاش کنید.');
      return;
    }

    // rpc returns an array of rows: [{ organization_id, organization_name }]
    if (!data || (Array.isArray(data) && data.length === 0)) {
      setError('مجموعه ایجاد نشد. لطفاً دوباره تلاش کنید.');
      return;
    }

    router.replace('/');
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

            {error && <Callout tone="error">{error}</Callout>}

            <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
              {loading ? 'در حال ایجاد...' : 'ایجاد مجموعه و ادامه'}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

export default function OnboardingPage() {
  return (
    <AuthGate requireAuth>
      <OnboardingForm />
    </AuthGate>
  );
}
