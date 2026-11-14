/**
 * Opt-in Staging JWT + Data API smoke for Migration 011 role-based DELETE.
 * Not part of CI. Refuses unless pinned to Staging and Migration 011 is
 * explicitly confirmed already applied.
 *
 * Service role is used only to:
 *   - create disposable Auth users
 *   - provision Admin/Agent membership rows
 *   - cleanup organizations and Auth users
 *
 * All business DELETE authorization assertions use real user session JWTs
 * (anon key + magic-link session). Never logs tokens, sessions, or secrets.
 *
 * Tables under test: properties, clients, needs, follow_ups, activities.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
// Pinned Staging origin (must match STAGING_ORIGIN from lib): https://dezonafotwyvvghbccko.supabase.co
// Production ref refused: gguvmewknanhzukugvpj
import {
  STAGING_ORIGIN,
  STAGING_CONFIRM,
  PRODUCTION_REF,
  results,
  record,
  refusal,
  jwtRoleClaim,
  denialKind,
  anonClient,
  createDisposable,
  sessionFor,
  trackedDelete,
} from "./staging-cloud-data-jwt-smoke-lib.mjs";

function loadConfig() {
  const urlRaw = process.env.STAGING_SUPABASE_URL;
  const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;
  const serviceKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const confirm = process.env.STAGING_SECURITY_TEST_CONFIRM;
  const migration011 = process.env.STAGING_MIGRATION_011_CONFIRMED;

  if (!urlRaw || !anonKey || !serviceKey || !confirm) {
    refusal(
      "Refusing to run: STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY, and STAGING_SECURITY_TEST_CONFIRM are all required.",
    );
  }
  if (migration011 !== "true") {
    refusal(
      "Refusing to run: STAGING_MIGRATION_011_CONFIRMED must be exactly 'true'. Migration 011 must already be applied on Staging before this smoke runs. This runner never applies migrations.",
    );
  }
  if (urlRaw.includes(PRODUCTION_REF)) {
    refusal("Refusing to run: Production project reference is not allowed.");
  }
  let parsed;
  try {
    parsed = new URL(urlRaw.trim());
  } catch {
    refusal("Refusing to run: STAGING_SUPABASE_URL is not a valid URL.");
  }
  if (
    parsed.origin !== STAGING_ORIGIN ||
    parsed.username ||
    parsed.password ||
    parsed.protocol !== "https:" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    refusal("Refusing to run: URL is not the pinned Staging origin.");
  }
  if (confirm !== STAGING_CONFIRM) {
    refusal("Refusing to run: STAGING_SECURITY_TEST_CONFIRM does not match the Staging project.");
  }
  if (anonKey === serviceKey) {
    refusal("Refusing to run: STAGING_SUPABASE_ANON_KEY and ST co");
  }
