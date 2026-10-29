# Migration history reconciliation

This document proposes aligning Git migration **filenames** with the **versions
observed in Staging** (`supabase_migrations.schema_migrations`). It does **not**
apply, repair, or re-run any migration on a remote database.

## Why timestamp filenames

Supabase CLI tracks applied migrations by the **version prefix** of each file
under `supabase/migrations/` and compares it to `schema_migrations.version`.
Matching is by version string, not by SQL content hash.

Official guidance uses `YYYYMMDDHHmmss_description.sql`. This repository
historically used sequential names (`001_…` … `008_…`). Staging recorded
**timestamp** versions when migrations were applied. Without renaming, a future
`supabase db push` would treat sequential files as **pending** and attempt to
re-apply SQL that is already reflected in the remote schema.

## Observed Staging history (read-only evidence)

Order is the remote `version` order (not sequential filename order):

| Remote version | Recorded name (remote) | Role in chain |
|----------------|------------------------|---------------|
| `20261022230848` | `001_initial_multitenant` | Foundation |
| `20261022230858` | `002_business_tables_rls` | Business tables RLS |
| `20261022230904` | `003_secure_org_policies` | Org policies |
| `20261022230911` | `004_default_privs_and_profile` | Default privileges / profile |
| `20261022230925` | `005_organization_invitations` | Invitations table + RPCs |
| `20261026115345` | `007_secure_invitation_privacy_and_validation` | Privacy / create validation (**before 006**) |
| `20261027003152` | `006_invite_fk_indexes_and_single_org_create` | FK indexes + single-org create |
| `20261029181022` | `008_rls_helper_schema_and_profile_policy_optimization` | Private schema helpers / policy optimization |

**007 was applied before 006 on Staging.** SQL review shows no hard object
dependency between 006 and 007 (both depend on 005). This PR preserves the
observed remote chronology via filename timestamps.

## Filename mapping (proposed Git layout)

| Old sequential path | New path on this branch |
|---------------------|-------------------------|
| `001_initial_multitenant.sql` | `20261022230848_initial_multitenant.sql` |
| `002_business_tables_rls.sql` | `20261022230858_business_tables_rls.sql` |
| `003_secure_org_policies.sql` | `20261022230904_secure_org_policies.sql` |
| `004_default_privs_and_profile.sql` | `20261022230911_default_privs_and_profile.sql` |
| `005_organization_invitations.sql` | `20261022230925_organization_invitations.sql` |
| `007_secure_invitation_privacy_and_validation.sql` | `20261026115345_secure_invitation_privacy_and_validation.sql` |
| `006_invite_fk_indexes_and_single_org_create.sql` | `20261027003152_invite_fk_indexes_and_single_org_create.sql` |
| `008_rls_helper_schema_and_profile_policy_optimization.sql` | `20261029181022_rls_helper_schema_and_profile_policy_optimization.sql` |

Sequential filenames are **removed** from `supabase/migrations/` on this branch
so the CLI execution directory has a single ordered set of files.

## Canonical sources and blob SHAs

| New file | Source branch | Source blob SHA-1 | Result blob SHA-1 |
|----------|---------------|-------------------|-------------------|
| `20261022230848_initial_multitenant.sql` | `fix/staging-security-audit-v2` | `d9085f156812bd33245e607e2a8b271310bdb41a` | same |
| `20261022230858_business_tables_rls.sql` | `fix/staging-security-audit-v2` | `2fa6e33feeb32393fc6de0b54fb53adde16a9920` | same |
| `20261022230904_secure_org_policies.sql` | `fix/staging-security-audit-v2` | `105ed798e3810ba25a7f21a8b0b63629c729dc2a` | same |
| `20261022230911_default_privs_and_profile.sql` | `fix/staging-security-audit-v2` | `7327060cffa7ce8226a73de75632efbc9c321ec9` | same |
| `20261022230925_organization_invitations.sql` | `feat/etehad-secure-invitations-and-rls` | `a472f670db4e5849c507fdff758a25e41e5dc9cf` | same |
| `20261026115345_secure_invitation_privacy_and_validation.sql` | `verify/migration-008-isolated-postgres-recovered` | `9dc3168c5eb0c61062b3ec6f7388ca2b57e918cd` | same |
| `20261027003152_invite_fk_indexes_and_single_org_create.sql` | `feat/etehad-secure-invitations-and-rls` | `2be7803024881d49f3eaa51d37b0cc015893e11d` | same |
| `20261029181022_rls_helper_schema_and_profile_policy_optimization.sql` | `verify/…` / `chore/record-staging-migration-008` | `43621e6b75d83f08ce65db168116b39188dfc23b` | same |

### Migration 007 comment-only difference

`feat/etehad-secure-invitations-and-rls` blob `9c60da2b…` and verify blob
`9dc3168c…` differ **only** on header line 4 (a comment about Staging apply
status). Executable SQL statements are identical.

This branch uses the verify blob (`9dc3168c…`), whose header points at
documentation for environment status instead of asserting “authored only — not
applied.” That assertion conflicts with Staging history evidence that a row for
this migration exists.

**Git blob hashes do not prove which exact text was submitted when the remote
row was written.** Remote `statements` were not re-fetched in this PR.

## Three different things (do not conflate)

1. **Live remote schema** — objects, policies, grants on the database.
2. **Recorded remote history** — rows in `supabase_migrations.schema_migrations`.
3. **Git migration files** — what CLI would apply on a fresh database or
   `db push`.

This PR only adjusts (3) so version prefixes can align with (2). It does not
mutate (1) or (2).

## Production

**Production migration history has not been verified.** This PR is not
permission to deploy to Production, run `db push` against Production, or run
`migration repair` anywhere.

## Automation in this repository

Inspected workflows do not run `supabase db push` or other remote migration
apply commands. CI (where present) runs unit/typecheck/lint/build. Staging
security smoke exercises API behavior only. Absence of automated push reduces
immediate accident risk but does not make sequential filenames safe for a
future CLI-based deploy pipeline.

## Local reproducibility warning

A fresh local `supabase db reset` (or equivalent) against a **disposable local
only** database should be tested before declaring the chain fully reproducible.
That test is outside the default scope of opening this Draft PR and must not
target a linked remote project.

## Explicit non-goals of this PR

- No SQL execution against Staging or Production
- No `migration repair`
- No merge of PR #1 or PR #2
- No change to `main`
- No claim that unit tests or prior smoke runs prove migration-history compatibility

## Relationship to other Draft PRs

- **PR #1** carries sequential `005`–`007` and invitation/security work.
- **PR #2** registers sequential `008` plus a Staging status note.
- **This PR** proposes a single ordered, timestamp-prefixed chain suitable for
  CLI version matching with observed Staging history.

Human review should decide sequencing: reconcile history, then supersede or
retarget related Drafts. Do not auto-merge.
