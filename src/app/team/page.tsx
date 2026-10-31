'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentMembership, type CurrentMembership } from '@/lib/auth/organization';
import { ROLE_PERMISSIONS } from '@/lib/auth/roles';
import { AuthGate } from '@/components/AuthGate';
import { Badge, Button, Card, EmptyState, ListSkeleton, PageHeader, Section } from '@/components/ui';

const ROLE_LABEL: Record<string, string> = {
  owner: 'مالک',
  admin: 'مدیر',
  agent: 'مشاور',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'فعال',
  invited: 'دعوت‌شده',
  disabled: 'غیرفعال',
};

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  active: 'green',
  invited: 'amber',
  disabled: 'red',
};

type MemberRow = {
  id: string;
  role: string;
  status: string;
  joined_at: string | null;
  user_id: string;
  profiles: { full_name: string | null } | null;
};

function TeamContent() {
  const [membership, setMembership] = useState<CurrentMembership | null>(null);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const m = await getCurrentMembership();
      if (cancelled) return;
      setMembership(m);

      if (!m) return;

      const supabase = createClient();
      const { data, error: qError } = await supabase
        .from('organization_members')
        .select(
          `
          id,
          role,
          status,
          joined_at,
          user_id,
          profiles ( full_name )
        `,
        )
        .eq('organization_id', m.organizationId)
        .order('created_at', { ascending: true });

      if (cancelled) return;

      if (qError) {
        setError(qError.message);
        setMembers([]);
        return;
      }

      setMembers((data as unknown as MemberRow[]) ?? []);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!membership || members === null) {
    return (
      <>
        <PageHeader title="تیم" back="/" />
        <ListSkeleton rows={4} />
      </>
    );
  }

  const canInvite = ROLE_PERMISSIONS[membership.role].canManageMembers;

  return (
    <>
      <PageHeader
        title="تیم مجموعه"
        subtitle={membership.organizationName}
        back="/"
        action={
          canInvite ? (
            <Button href="/team/invite" size="sm" variant="secondary">
              دعوت عضو
            </Button>
          ) : undefined
        }
      />

      <Section>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {members.length === 0 ? (
          <EmptyState
            title="هنوز عضوی ثبت نشده"
            hint="مالک یا مدیر می‌تواند همکاران را دعوت کند."
          />
        ) : (
          <Card className="divide-y divide-slate-100">
            {members.map((m) => {
              const name = m.profiles?.full_name || 'بدون نام';
              const isCurrent = m.user_id === membership.userId;

              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {name}
                      {isCurrent && (
                        <span className="mr-1.5 text-xs font-normal text-slate-400">(شما)</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {ROLE_LABEL[m.role] ?? m.role}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[m.status] ?? 'slate'}>
                    {STATUS_LABEL[m.status] ?? m.status}
                  </Badge>
                </div>
              );
            })}
          </Card>
        )}
      </Section>

      {!canInvite && (
        <Section>
          <p className="text-center text-xs text-slate-400">
            فقط مالک یا مدیر مجموعه می‌تواند عضو جدید دعوت کند.
          </p>
        </Section>
      )}
    </>
  );
}

export default function TeamPage() {
  return (
    <AuthGate requireOrganization>
      <TeamContent />
    </AuthGate>
  );
}
