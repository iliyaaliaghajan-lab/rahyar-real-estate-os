# Organization invitations (اتحاد)

## What is implemented (code + migrations authored)

- Table `organization_invitations` (migration **005**)
- RPC `create_organization_invitation(p_email, p_role)` — owner/admin only; role `admin` or `agent` only
- RPC `accept_organization_invitation(p_token)` — authenticated user; email must match; single-use; 7-day expiry
- UI `/team/invite` — persists invite, shows **copyable link** (does **not** send email)
- UI `/invite/accept?token=…` — accept after login; preserves token via `next`
- Migration **006** — FK covering indexes on invitations; `create_organization_with_owner` rejects callers who already have an active membership
- Migration **007** — revoke direct SELECT on invitations; drop member view policy; create pre-checks aligned with accept

## Verification status (keep these separate)

| Layer | Status |
|-------|--------|
| Migrations **001–005** on Supabase project `etehad-staging` (`dezonafotwyvvghbccko`) | **Applied** (operator-reported staging history) |
| Migration **006** on staging | **Authored only — not applied** |
| Migration **007** on staging | **Applied** (operator-authorized; present in staging migration history). Catalog check (operator, not an automated re-query): no direct SELECT for `authenticated` / `anon` / `PUBLIC`; RLS on; no policies left; EXECUTE of `create_organization_invitation` for `authenticated` only. **Does not prove** authenticated create/accept or tenant isolation. |
| Static / unit contract tests (`npm test`) | Local/CI evidence only — **not** live RLS proof |
| Live authenticated RLS / invitation E2E on staging | **Not verified** — no disposable Staging sessions available to the execution environment |
| Browser E2E (login → accept → team) | **Not verified** |
| Concurrency (dual accept / dual create) | **Not verified** live |
| Production (`rahyar`) / Netlify production deploy | **Not** modified by this work |

## Migration 007 (applied on Staging; authored in repo)

File: `supabase/migrations/007_secure_invitation_privacy_and_validation.sql`

- Revokes **all** direct privileges on `organization_invitations` from `PUBLIC`, `anon`, and `authenticated`.
- Drops policy `Members can view org invitations`.
- RLS remains enabled; `service_role` unchanged.
- No list-invitations RPC (create/accept stay the only intentional paths).
- `create_organization_invitation` now rejects:
  - any existing membership row (any status) for the target email in the same organization;
  - an **active** membership for the target email in a different organization.
- If the target email is not yet in `auth.users`, invitation for future signup is still allowed.
- All prior controls retained: `SECURITY DEFINER`, `search_path = ''`, caller exactly-one-active membership, owner/admin only, role `admin`|`agent`, token hashing, EXECUTE for `authenticated` only.

These checks align create with accept so the system does not issue links that accept would reject.

Catalog metadata matching the revoke/EXECUTE claims was **operator-reported** after application. Authenticated behavior is still **not run**.

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

- Function check on accept: reject if user already has an **active** membership in another org.
- Function check on create org (006): reject if caller already has any active membership. **006 is not applied on Staging**; the partial unique index from **005** is the database backstop if 005 is applied.
- Database: partial unique index `idx_org_members_one_active_per_user` on `organization_members(user_id) WHERE status = 'active'`.

### Before applying migration 005 (already done on empty staging)

```sql
SELECT user_id, count(*) AS active_count
FROM public.organization_members
WHERE status = 'active'
GROUP BY user_id
HAVING count(*) > 1;
```

Must return zero rows or the partial unique index fails.

## Expiration semantics (accept)

- Rejected when `expires_at < now()` (`Invitation expired`).
- MVP does **not** persist `status = 'expired'` inside the failing accept RPC.
- Authoritative: `expires_at` plus `pending` / `accepted` / `revoked`.

## What is still a stub / not done

- Automatic email delivery of the invite link
- Multi-organization membership UX (index would need revisiting)
- Live authenticated invitation and isolation tests (see staging plan)

## Migration order

1. `001_initial_multitenant.sql`
2. `002_business_tables_rls.sql`
3. `003_secure_org_policies.sql`
4. `004_default_privs_and_profile.sql` (optional profile trigger)
5. `005_organization_invitations.sql` — requires `extensions.digest` (pgcrypto)
6. `006_invite_fk_indexes_and_single_org_create.sql` — after 005 (**not applied on Staging**)
7. `007_secure_invitation_privacy_and_validation.sql` — after 005 (**applied on Staging**)

## Security notes

- Raw token returned **once** from create RPC; only `token_hash` stored
- No `owner` role via invite (CHECK + function guard)
- Membership write via DEFINER functions only; no client INSERT grants on members
- Login/callback `next` must be a relative path (open-redirect blocked)
- Advisor may flag `SECURITY DEFINER` + `EXECUTE` for `authenticated` on app RPCs and RLS helpers — expected for this design; do not revoke without breaking RLS
- After 007: authenticated clients cannot `SELECT` invitation rows directly (catalog-confirmed by operator; not live-session confirmed)

## Env vars (names only)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Never put service role keys in `NEXT_PUBLIC_*`.
