# Organization invitations (اتحاد)

## What is implemented (code + migrations authored)

- Table `organization_invitations` (migration **005**)
- RPC `create_organization_invitation(p_email, p_role)` — owner/admin only; role `admin` or `agent` only
- RPC `accept_organization_invitation(p_token)` — authenticated user; email must match; single-use; 7-day expiry
- UI `/team/invite` — persists invite, shows **copyable link** (does **not** send email)
- UI `/invite/accept#token=…` — token in **URL fragment only**; accept after login
- Migration **006** — FK covering indexes on invitations; `create_organization_with_owner` rejects callers who already have an active membership
- Migration **007** — revoke direct SELECT on invitations; drop member view policy; create pre-checks aligned with accept

## Invitation link format (token transport)

**Canonical shareable URL:** `/invite/accept#token=<raw-token>`

- The token is placed in the **URL fragment** (`#token=…`), not the query string.
- Fragments are not transmitted in the initial HTTP request to the server, so they do not appear in ordinary server/proxy access logs for that first navigation.
- On the accept page the client:
  1. Reads `window.location.hash`
  2. Immediately clears the fragment (and any query string) with `history.replaceState`, preserving Next.js history state
  3. Keeps the token only in component memory while calling `accept_organization_invitation`
- The token is **never** written into `next`, login URLs, OTP `emailRedirectTo`, or `/auth/callback` query parameters.
- **No `localStorage` or `sessionStorage` handoff** is used. If the recipient is unauthenticated, they are sent to `/login` without a token-bearing redirect. After successful login they must **reopen the original invitation link**.

### Legacy query-format links

Older links of the form `/invite/accept?token=…` are rejected:

- The presence of a legacy `token` query parameter is detected without using its value.
- The query string is cleared from the visible URL.
- `accept_organization_invitation` is **not** called with a legacy query token.
- The user is told (in Persian) that the link uses the old format and the inviter must create and send a new link.

**Important:** the initial browser request for a legacy query-format link has already reached the server with its query string. Client-side cleanup cannot erase or prevent any historical server/proxy logging of that initial request. New invitations must use the fragment form exclusively.

### Limits of this protection

- Same-origin XSS can still read the fragment before it is cleared, or observe in-memory values. This URL-format change does **not** protect against XSS.
- Browser history may briefly contain the fragment until cleanup runs.
- Invitation expiry, single-use semantics, and RPC authorization are unchanged.

## Verification status (keep these separate)

| Layer | Status |
|-------|--------|
| Migrations **001–007** on Supabase project `etehad-staging` (`dezonafotwyvvghbccko`) | **Recorded in Staging migration history.** Migration **006** was applied **after** **007**; the history was **not** rewritten. |
| Migration **006** effects (indexes / single-org create guard) | Operator-reported post-apply checks: expected invitation FK indexes and active-membership guard in `create_organization_with_owner`. |
| Migration **007** effects (invitation privacy) | Operator-reported: RLS on `organization_invitations`; no direct `SELECT` for `authenticated` / `anon` / `PUBLIC`; no remaining policies; `authenticated` can EXECUTE `create_organization_invitation`. |
| Static / unit contract tests (`npm test`) | Local/CI evidence only — **not** live RLS proof by themselves |
| Live Staging security smoke (automated runner, 12 scenarios) | **Passed** on HEAD `e4bb442baffdde8db47bbdded8d5855aab1838f6`: GitHub Actions run [40428548889](https://github.com/iliyaaliaghajan-lab/rahyar-real-estate-os/actions/runs/40428548889); runner id `89594cd043ef`; `pass=12` `fail=0` `skip=0`; **CLEANUP OK**. See `docs/STAGING_AUTOMATED_SECURITY_TESTS.md`. |
| Invitation expiry path | **Not verified** live |
| Concurrent dual accept / dual create | **Not verified** live |
| Browser E2E (login → callback → accept UI) | **Not verified** |
| Full business-table cross-tenant DML matrix | **Not verified** as a complete suite (smoke covers org/member isolation for the disposable orgs only) |
| Production (`rahyar` / `gguvmewknanhzukugvpj`) / Netlify production | **Not** modified by this work |

## Migration 007 (present in Staging history; authored in repo)

File: `supabase/migrations/007_secure_invitation_privacy_and_validation.sql`

- Revokes **all** direct privileges on `organization_invitations` from `PUBLIC`, `anon`, and `authenticated`.
- Drops policy `Members can view org invitations`.
- RLS remains enabled; `service_role` unchanged.
- No list-invitations RPC (create/accept stay the only intentional paths).
- `create_organization_invitation` rejects:
  - any existing membership row (any status) for the target email in the same organization;
  - an **active** membership for the target email in a different organization.
- If the target email is not yet in `auth.users`, invitation for future signup is still allowed.
- All prior controls retained: `SECURITY DEFINER`, `search_path = ''`, caller exactly-one-active membership, owner/admin only, role `admin`|`agent`, token hashing, EXECUTE for `authenticated` only.

Live smoke (L1, L2, L3, L4, L5a/b, L6, S5, S6) exercises authenticated create/accept and direct-select denial for disposable users. It does **not** replace a full Security Advisor review of every `SECURITY DEFINER` function.

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
- Function check on create org (**006**): reject if caller already has any active membership. **006 is recorded in Staging history** (applied after 007).
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
- Live expiry rejection is **not** covered by the current smoke runner.

## What is still a stub / not done

- Automatic email delivery of the invite link
- Multi-organization membership UX (index would need revisiting)
- Live tests for concurrency, expiry, full browser path, and exhaustive business-table isolation

## Migration order (repository file order)

1. `001_initial_multitenant.sql`
2. `002_business_tables_rls.sql`
3. `003_secure_org_policies.sql`
4. `004_default_privs_and_profile.sql` (optional profile trigger)
5. `005_organization_invitations.sql` — requires `extensions.digest` (pgcrypto)
6. `006_invite_fk_indexes_and_single_org_create.sql` — after 005
7. `007_secure_invitation_privacy_and_validation.sql` — after 005

**Staging history note:** on `etehad-staging`, **006 was applied after 007**. That order differs from the repository numbering; the history was preserved rather than rewritten. Prefer applying 006 before 007 on new environments.

## Security notes

- Raw token returned **once** from create RPC; only `token_hash` stored
- Shareable links use `#token=…` (fragment); query-string tokens are rejected as legacy
- No `owner` role via invite (CHECK + function guard)
- Membership write via DEFINER functions only; no client INSERT grants on members
- Login/callback `next` must be a relative path (open-redirect blocked) and must not carry invitation tokens
- Advisor may flag `SECURITY DEFINER` + `EXECUTE` for `authenticated` on app RPCs and RLS helpers — expected for this design; do not revoke without breaking RLS
- After 007: authenticated clients cannot `SELECT` invitation rows directly (supported by catalog checks and by live smoke L1)

## Env vars (names only)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Never put service role keys in `NEXT_PUBLIC_*`.
