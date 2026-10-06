# رهیار (Rahyar) — MVP

دستیار هوشمند مشاوران املاک: ثبت فایل → فهم متن فارسی → ذخیره → ثبت مشتری و نیاز → تطبیق توضیح‌پذیر → پیگیری.
یک اپ Next.js، کاملاً آفلاین (IndexedDB/Dexie)، بدون سرور، بدون کلید هوش مصنوعی.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # parser, money, matching, demo-journey tests (no browser needed)
npm run typecheck && npm run lint
npm run build        # static export → ./out
npx serve out        # production preview; service worker is active only in this mode
```

PWA/offline: open the *production* build once online, then "Install"/"Add to Home Screen".
The service worker registers only when `NODE_ENV=production`.

## Adopt into the existing repository (keeps the old Phase 1 work)

From the repository root:

```bash
mkdir -p legacy
git mv rahyar-phase1-review-fixes.tar.gz legacy/     # preserved, not deleted
tar -xzf rahyar-mvp.tar.gz && rm rahyar-mvp.tar.gz
git add -A && git commit -m "feat: simplified offline-first MVP (Next.js + Dexie)"
```

## Architecture

```
src/app/            routes (static export; entity pages use ?id= so they work offline)
src/features/       properties, clients, matching, followups, assistant (UI + feature logic)
src/components/     AppShell (bottom nav), ui primitives, SeedGate, SW registration
src/lib/parser/     SmartParser → LocalPersianParser (deterministic; never guesses)
src/lib/matching/   hard constraints → weighted score → reasons (rules-v1)
src/lib/ai/         AIProvider interface + RuleBasedProvider (LLM provider plugs in here later)
src/lib/repositories/  interfaces + Dexie implementation; the UI only talks to these
src/lib/db/         Dexie schema, demo data (pure), seed, backup/reset
```

## Behaviour rules (enforced in code and tests)

- Unknown stays unknown (`null` / empty); the parser never fills a field it did not read.
- Money is stored as integer toman. A unitless «رهن ۵۰۰» is read as ۵۰۰ میلیون تومان **and shown as an assumption** on the review screen.
- The match percentage is labelled «امتیاز تطبیق مبتنی بر قوانین» (rule score, not a probability).
  Hard constraints (transaction, type, area range, budget) reject; unknown data earns 0 points and is flagged.
- Messages/follow-up suggestions are drafts built only from stored facts; nothing is sent anywhere.

## Deferred (not in this MVP)

Backend/auth/OTP, PostgreSQL/PostGIS/pgvector, Redis, queues, RLS, LLM provider, sync, documents, billing, plugins.
The repository interfaces (`src/lib/repositories/types.ts`) and `AIProvider` are the extension points.
