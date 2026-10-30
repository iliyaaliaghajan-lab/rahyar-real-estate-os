'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getCurrentMembership, type CurrentMembership, type MemberRole } from '@/lib/auth/organization';
import { ROLE_PERMISSIONS } from '@/lib/auth/roles';
import { buildInviteAcceptUrl } from '@/lib/auth/inviteUrl';
import { AuthGate } from '@/components/AuthGate';
import { Button, Card, Callout, Field, Input, PageHeader, Select } from '@/components/ui';

type InviteResult = {
  invitation_id: string;
  token: string;
  expires_at: string;
  invite_email: string;
  invite_role: 'admin' | 'agent';
};

function InviteForm() {
  const router = useRouter();
  const [membership, setMembership] = useState<CurrentMembership | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<MemberRole, 'owner'>>('agent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await getCurrentMembership();
      if (cancelled) return;

      if (!m || !ROLE_PERMISSIONS[m.role].canManageMembers) {
        router.replace('/team');
        return;
      }
      setMembership(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!membership || !email.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc('create_organization_invitation', {
      p_email: email.trim().toLowerCase(),
      p_role: role,
    });

    setLoading(false);

    if (rpcError) {
      setError(rpcError.message || 'ثبت دعوت ناموفق بود.');
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.token) {
      setError('پاسخ سرور نامعتبر بود.');
      return;
    }

    setResult(row as InviteResult);
    setEmail('');
  }

  function inviteLink(token: string) {
    if (typeof window === 'undefined') return '';
    return buildInviteAcceptUrl(window.location.origin, token);
  }

  async function copyLink() {
    if (!result?.token) return;
    try {
      await navigator.clipboard.writeText(inviteLink(result.token));
      setCopied(true);
    } catch {
      setCopied(false);
      setError('کپی در کلیپ‌بورد ممکن نشد؛ لینک را دستی انتخاب کنید.');
    }
  }

  if (!membership) {
    return (
      <>
        <PageHeader title="دعوت عضو" back="/team" />
        <div className="px-4 py-8 text-center text-sm text-slate-500">در حال بررسی...</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="دعوت عضو جدید"
        subtitle={membership.organizationName}
        back="/team"
      />

      <div className="px-4 pb-8 space-y-4">
        <Card className="p-5">
          <p className="mb-4 text-sm leading-7 text-slate-600">
            ایمیل همکار و نقش او را مشخص کنید. پس از ثبت، یک{' '}
            <strong>لینک یک‌بارمصرف</strong> دریافت می‌کنید تا خودتان برای او بفرستید.
            سیستم در این نسخه ایمیل خودکار ارسال نمی‌کند.
          </p>

          <form onSubmit={handleInvite} className="space-y-4">
            <Field label="ایمیل" hint="همان ایمیلی که همکار با آن وارد اتحاد می‌شود">
              <Input
                type="email"
                required
                dir="ltr"
                className="text-left"
                placeholder="colleague@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </Field>

            <Field label="نقش">
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'agent')}
                disabled={loading}
              >
                <option value="agent">مشاور</option>
                <option value="admin">مدیر</option>
              </Select>
            </Field>

            {error && <Callout tone="error">{error}</Callout>}

            <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
              {loading ? 'در حال ثبت...' : 'ایجاد لینک دعوت'}
            </Button>
          </form>
        </Card>

        {result && (
          <Card className="p-5 space-y-3">
            <Callout tone="success">
              دعوت برای «{result.invite_email}» با نقش «
              {result.invite_role === 'admin' ? 'مدیر' : 'مشاور'}» در پایگاه داده ثبت شد.
              لینک را کپی کنید و دستی ارسال کنید — ایمیلی از طرف سیستم فرستاده نشده است.
            </Callout>
            <Field label="لینک دعوت (یک‌بارمصرف، حداکثر ۷ روز)">
              <Input
                dir="ltr"
                className="text-left text-xs"
                readOnly
                value={inviteLink(result.token)}
                onFocus={(e) => e.target.select()}
              />
            </Field>
            <p className="text-xs text-slate-500">
              انقضا: {new Date(result.expires_at).toLocaleString('fa-IR')}
            </p>
            <Button type="button" className="w-full" variant="secondary" onClick={copyLink}>
              {copied ? 'کپی شد' : 'کپی لینک'}
            </Button>
          </Card>
        )}
      </div>
    </>
  );
}

export default function InvitePage() {
  return (
    <AuthGate requireOrganization>
      <InviteForm />
    </AuthGate>
  );
}
