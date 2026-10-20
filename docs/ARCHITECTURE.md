# Architecture Decision Record
## Rahyar / اتحاد — Multi-Tenant Foundation

**Branch:** `feat/multitenant-foundation`  
**Date:** 2026-10-21  
**Status:** Accepted  
**Authors:** Technical Lead (Grok) + Product Owner

---

## 1. Current State (as of main @ 290db405)

| Layer | Technology | Notes |
|-------|------------|-------|
| Framework | Next.js 14 (App Router) | `output: 'export'` → pure static |
| UI | React 18 + Tailwind + RTL | Mobile-first PWA |
| Storage | Dexie (IndexedDB) | Single-user, device-local |
| Data Access | Repository pattern | Clean swap point exists |
| Auth | None | No login, no users, no roles |
| Backend | None | No API routes, no server |
| AI | RuleBasedProvider only | LLM interface already prepared |

**Key constraint:**  
`output: 'export'` makes server-side code (API routes, Server Actions, middleware) impossible. This must change before multi-user features can be added safely.

---

## 2. Product Goal for Phase 1

Turn the current single-user offline MVP into a **secure multi-tenant system** where:

- An **Owner** can create an Organization (آژانس / مجموعه).
- The Owner can invite **Admins** and **Agents**.
- Each user only sees data belonging to their Organization.
- Permissions are enforced both in the UI **and** at the database level (RLS).
- Existing offline capabilities are preserved as far as technically possible (hybrid mode later).

### Roles (initial set)

| Role | Persian | Capabilities |
|------|---------|--------------|
| `owner` | مالک | Full control of the organization, users, data, billing later |
| `admin` | مدیر | Manage team, view all org data, limited settings |
| `agent` | مشاور | Manage own clients/properties + shared data according to policy |

Permissions will be expandable later without schema rewrite.

---

## 3. Technical Decisions

### 3.1 Backend & Auth
**Choice:** Supabase (Auth + PostgreSQL + RLS)

**Reasons:**
- Auth (email + magic link / OTP ready)
- Row Level Security is the correct place for tenant isolation
- Already mentioned in product requirements
- Low operational overhead for early stage

**Alternative considered:** Custom Next.js Auth + own Postgres → higher cost and complexity at this stage.

### 3.2 Next.js Configuration Change
**Decision:** Remove `output: 'export'`

- Enables API Routes / Server Actions / Middleware
- Required for secure auth callbacks and server-side permission checks
- PWA will still work (service worker + manifest remain)
- Static export can be re-evaluated later if needed for pure offline distribution

### 3.3 Data Model (Phase 1)

```
organizations
  id, name, slug, created_at, ...

profiles
  id (= auth.users.id), full_name, avatar_url, ...

organization_members
  organization_id, user_id, role, status, invited_at, joined_at

# Existing tables will gain organization_id
properties, clients, needs, follow_ups, activities
```

All business tables will be scoped by `organization_id`.
RLS policies will enforce:  
`organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())`

### 3.4 Repository Layer Strategy
Keep the existing `src/lib/repositories` interfaces.

- Current: `dexieRepositories`
- New: `supabaseRepositories` (implements same interfaces)
- UI continues to talk only to the repository abstraction
- Migration path stays clean

### 3.5 Offline & Sync (deferred to Phase 2)
Phase 1 focuses on **online multi-user correctness**.  
Hybrid offline + conflict resolution comes after the security model is proven.

---

## 4. Security Rules (non-negotiable)

1. UI hiding of buttons is **not** access control.
2. Every query must be protected by RLS.
3. No service-role key ever reaches the browser.
4. Organization isolation must be tested with at least two separate orgs.
5. Secrets stay in environment variables / Supabase dashboard only.

---

## 5. Implementation Order (Phase 1)

1. ✅ Create branch + this ADR
2. Adjust `next.config.mjs` (remove static export)
3. Add Supabase client (server + browser)
4. Create database schema + RLS policies
5. Implement Auth (login / logout / session)
6. Organization creation + membership
7. Role-based guards
8. Migrate repository interfaces to support organization scope
9. Basic tests for isolation
10. Manual security review before any production deploy

---

## 6. Out of Scope for this Branch

- Full data migration from IndexedDB
- Real-time sync / conflict resolution
- Advanced AI features
- Billing
- Document storage
- Mobile native apps

---

## 7. Success Criteria for Phase 1

- [ ] A user can sign up / log in
- [ ] An owner can create an organization
- [ ] An owner can invite another user with a role
- [ ] User A from Org 1 cannot read data of Org 2 (verified by test)
- [ ] Existing offline MVP still builds and runs in development
- [ ] No secrets committed to the repository

---

**Next action:** Proceed to step 2 of implementation — adjust Next.js configuration.
