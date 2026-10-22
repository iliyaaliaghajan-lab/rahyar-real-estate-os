# Organization invitations (اتحاد)

## What is implemented

- Table `organization_invitations` (migration **005**)
- RPC `create_organization_invitation(p_email, p_role)` — owner/admin only; role `admin` or `agent` only
- RPC `accept_organization_invitation(p_token)` — authenticated user; email must match; single-use; 7-day expiry
- UI `/team/invite` — persists invite, shows **copyable link** (does **not** send email)
- UI `/invite/accept?token=…` — accept after login; preserves token via `next`

## Membership rule (create invite)

Aligned with `getCurrentMembership()`:

- **Exactly one** active membership → proceed if role is `owner` or `admin`
- **Zero** active memberships → error `No active organization membership`
- **Multiple** active memberships → error `Multiple active organization memberships` (no arbitrary `ORDER BY … LIMIT 1`)

## Accept: existing membership

- If a row already exists in `organization_members` for the same `(organization_id, user_id)` (any status), accept **fails** with `Membership already exists`.
- Accept **never** uses `ON CONFLICT DO UPDATE` to change role or re-activate a disabled/invited row.
- Only a **new** membership insert is allowed.

## Single active organization (phase 1)

- Function check: reject if user already has an **active** membership in another org.
- Database: partial unique index `idx_org_members_one_active_per_user` on `organization_members(user_id) WHERE status = 'active'` so two concurrent accepts cannot both become active for different orgs.

### Before applying migration 005

**Must** inspect for pre-existing duplicate active memberships. Creating the partial unique index **fails** if any `user_id` already has more than one row with `status = 'active'`.

```sql
-- Run on staging before 005; fix or merge duplicates first.
SELECT user_id, count(*) AS active_count
FROM public.organization_members
WHERE status = 'active'
GROUP BY user_id
HAVING count(*) > 1;
```

On a fresh empty staging schema this query returns no rows and the index applies cleanly.

## Expiration semantics (accept)

- Rejected when `expires_at < now()` (`Invitation expired`).
- MVP does **not** persist `status = 'expired'` inside the failing accept RPC.
- Authoritative: `expires_at` plus `pending` / `accepted` / `revoked`.

## What is still a stub / not done

- Automatic email delivery of the invite link
- Multi-organization membership UX (index would need revisiting)
- Live RLS verification on staging (migrations authored, **not applied** in this task)

## Migration order

1. `001_initial_multitenant.sql`
2. `002_business_tables_rls.sql`
3. `003_secure_org_policies.sql`
4. `004_default_privs_and_profile.sql` (optional profile trigger)
5. `005_organization_invitations.sql` — requires `extensions.digest` (pgcrypto on Supabase)

## Security notes

- Raw token returned **once** from create RPC; only `token_hash` stored
- No `owner` role via invite (CHECK + function guard)
- Membership write via DEFINER functions only; no client INSERT grants on members
- Login/callback `next` must be a relative path (open-redirect blocked)

## Env vars (names only)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Never put service role keys in `NEXT_PUBLIC_*`.
