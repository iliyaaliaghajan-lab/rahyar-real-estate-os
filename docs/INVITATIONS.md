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

## Expiration semantics (accept)

- Acceptance is rejected when `expires_at < now()` (`Invitation expired`).
- MVP does **not** persist `status = 'expired'` inside the failing accept RPC: an `UPDATE` followed by `RAISE` would roll back in the same transaction.
- Authoritative checks: `expires_at`, plus `status` values `pending` / `accepted` / `revoked`.
- A later maintenance job may mark rows expired if product needs that in the table; it is not claimed by this RPC.

## What is still a stub / not done

- Automatic email delivery of the invite link
- Multi-organization membership UX for one user
- Live RLS verification on staging (migrations authored, **not applied** in this task)
- Persisting `status = expired` on reject (optional cleanup job)

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
