# Migration history reconciliation (integration candidate)

This document describes the **consolidated Git migration layout** for the
integration branch `integration/etehad-migration-history-v1`. It aligns
executable filenames under `supabase/migrations/` with **versions observed in
Staging** (`supabase_migrations.schema_migrations`).

**This is a repository layout proposal only.** It does **not** apply, repair,
or re-run any migration on a remote database. Git filename reconciliation does
**not** mutate remote migration history.

## Why timestamp filenames

Supabase CLI tracks applied migrations by the **version prefix** of each file
under `supabase/migrations/` and compares it to `schema_migrations.version`.
Matching is by version string, not by SQL content hash.

Official guidance uses `YYYYMMDDHHmmss_description.sql`. Earlier Draft work used
sequential names (`001_…` … `008_…`). Staging recorded **timestamp** versions
when migrations were applied. Without renaming, a future `supabase db push`
could treat sequential files as **pending** and attempt to re-apply SQL that is
already reflected in the remote schema.

## Observed Staging history (read-only evidence)

Order is the remote `version` order (not historical sequential filename order):

| Remote version | Historical sequential role | Role in chain |
|----------------|----------------------------|---------------|
| `20261022230848` | `001_initial_multitenant` | Foundation |
| `20261022230858` | `002_business_tables_rls` | Business tables RLS |
| `20261022230904` | `003_secure_org_policies` | Org policies |
| `20261022230911` | `004_default_privs_and_profile` | Default privileges / profile |
| `20261022230925` | `005_organization_invitations` | Invitations table + RPCs |
| `20261026115345` | `007_secure_invitation_privacy_and_validation` | Privacy / create validation (**before 006**) |
| `20261027003152` | `006_invite_fk_indexes_and_single_org_create` | FK indexes + single-org create |
| `20261029181022` | `008_rls_helper_schema_and_profile_policy_optimization` | Private schema helpers / policy optimization |

**007 was applied before 006 on Staging.** SQL review shows no hard object
dependency between 006 and 007 (both depend on 005). This candidate preserves
the observed remote chronology via filename timestamps.

## Integrated Git layout (active executable files)

| Version prefix | Active filename | Canonical blob SHA |
|----------------|-----------------|--------------------|
| `20261022230848` | `…_initial_multitenant.sql` | `d9085f156812bd33245e607e2a8b271310bdb41a` |
| `20261022230858` | `…_business_tables_rls.sql` | `2fa6e33feeb32393fc6de0b54fb53adde16a9920` |
| `20261022230904` | `…_secure_org_policies.sql` | `105ed798e3810ba25a7f21a8b0b63629c729dc2a` |
| `20261022230911` | `…_default_privs_and_profile.sql` | `7327060cffa7ce8226a73de75632efbc9c321ec9` |
| `20261022230925` | `…_organization_invitations.sql` | `a472f670db4e5849c507fdff758a25e41e5dc9cf` |
| `20261026115345` | `…_secure_invitation_privacy_and_validation.sql` | `9dc3168c5eb0c61062b3ec6f7388ca2b57e918cd` |
| `20261027003152` | `…_invite_fk_indexes_and_single_org_create.sql` | `2be7803024881d49f3eaa51d37b0cc015893e11d` |
| `20261029181022` | `…_rls_helper_schema_and_profile_policy_optimization.sql` | `43621e6b75d83f08ce65db168116b39188dfc23b` |

Exactly **eight** executable SQL files. Sequential `001_`–`008_` executable
copies are **not** present on this integration branch.

### Provenance of blobs

- **001–005, 006 (timestamp 20261027003152):** preserved from the PR #1 line
  (and matching base blobs).
- **007 (timestamp 20261026115345):** canonical verify blob `9dc3168c…`. The
  PR #1 sequential `007` blob `9c60da2b…` differs **only** on a header comment
  line about Staging apply status; executable SQL statements are identical.
  The verify header does not assert “authored only — not applied,” which would
  conflict with Staging history evidence.
- **008:** exact PR #2 / verify-recovered blob `43621e6b…` (unchanged SQL).

**Git blob hashes do not prove which exact text was submitted when the remote
row was written.** Remote `statements` were not re-fetched for this candidate.

## Three different things (do not conflate)

1. **Live remote schema** — objects, policies, grants on the database.
2. **Recorded remote history** — rows in `supabase_migrations.schema_migrations`.
3. **Git migration files** — what CLI would apply on a fresh database or
   `db push`.

This integration only adjusts (3) so version prefixes can align with (2). It
does **not** mutate (1) or (2).

## Production

**Production migration history has not been verified.** This candidate is not
permission to deploy to Production, run `db push` against Production, or run
`migration repair` anywhere.

## Local reproducibility warning

A fresh local `supabase db reset` (or equivalent) against a **disposable local
only** database should be tested before declaring the chain fully reproducible.
That test is outside the scope of opening this Draft PR and must not target a
linked remote project. Local disposable database reproducibility is **not yet
proven**.

## Automation in this repository

Inspected workflows do not run `supabase db push` or other remote migration
apply commands. CI (where present) runs unit/typecheck/lint/build. Staging
security smoke exercises API behavior only. Absence of automated push reduces
immediate accident risk but does not make a future CLI-based deploy pipeline
automatically safe.

## Explicit non-goals

- No SQL execution against Staging or Production
- No `migration repair`
- No automatic migration deployment
- No claim that unit tests or prior smoke runs prove migration-history
  compatibility with live remote catalogs
- No modification of original Draft PRs #1, #2, or #3 by this candidate

## Relationship to source Draft PRs

Content for this **integration candidate** was assembled from:

- **PR #1** — application, security, invitation-token protection, tests, and
  related documentation.
- **PR #2** — Migration 008 SQL blob and Staging status documentation.
- **PR #3** — timestamp-aligned migration filename layout and reconciliation
  evidence.

Those three PRs remain **independent open Drafts**. They are **source material**
incorporated into this candidate; they are **not** future dependencies of the
integrated tree once this candidate is reviewed on its own merits. Do not
auto-merge any of these PRs.
