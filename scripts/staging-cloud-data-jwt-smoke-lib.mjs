/**
 * Opt-in Staging JWT + Data API + RLS smoke helpers (Migration 009).
 * Imported by staging-cloud-data-jwt-smoke.mjs.
 */
import { createClient } from "@supabase/supabase-js";

export const STAGING_ORIGIN = "https://dezonafotwyvvghbccko.supabase.co";
export const STAGING_CONFIRM = "dezonafotwyvvghbccko";
export const PRODUCTION_REF = "gguvmewknanhzukugvpj";

export const results = [];

export function record(id, status, detail) {
  results.push({ id, status, detail });
  console.log(`${status} ${id} — ${detail}`);
}

export function refusal(message) {
  console.error(message);
  process.exit(1);
}

export function loadConfig() {
  const urlRaw = process.env.STAGING_SUPABASE_URL;
  const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;
  const serviceKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const confirm = process.env.STAGING_SECURITY_TEST_CONFIRM;
  if (!urlRaw || !anonKey || !serviceKey || !confirm) {
    refusal(
      "Refusing to run: STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY, and STAGING_SECURITY_TEST_CONFIRM are all required.",
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
    refusal("Refusing to run: STAGING_SUPABASE_ANON_KEY and STAGING_SUPABASE_SERVICE_ROLE_KEY must be different.");
  }
  const anonRole = jwtRoleClaim(anonKey);
  if (anonRole === "service_role") {
    refusal("Refusing to run: STAGING_SUPABASE_ANON_KEY must not carry the service_role claim.");
  }
  return { url: STAGING_ORIGIN, anonKey, serviceKey };
}

/** Decode JWT payload role claim without verifying signature. Never log the token. */
export function jwtRoleClaim(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    const payload = JSON.parse(json);
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function denialKind(error) {
  if (!error) return "none";
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  const code = String(error.code || "");
  if (
    code === "PGRST301" ||
    msg.includes("jwt") ||
    msg.includes("not authenticated") ||
    msg.includes("invalid claim")
  ) {
    return "auth";
  }
  if (
    code === "42501" ||
    msg.includes("permission denied") ||
    msg.includes("row-level security") ||
    msg.includes("violates row-level security")
  ) {
    return "permission";
  }
  if (
    code === "23503" ||
    msg.includes("foreign key") ||
    msg.includes("violates foreign key")
  ) {
    return "fk";
  }
  if (
    code === "23514" ||
    msg.includes("check constraint") ||
    msg.includes("organization_id cannot be changed") ||
    msg.includes("created_by cannot be changed") ||
    msg.includes("must belong to the same organization")
  ) {
    return "trigger";
  }
  return "other";
}

export function anonClient(url, anonKey) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function createDisposable(admin, email, runId, label) {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      purpose: "staging-cloud-data-jwt-smoke",
      run_id: runId,
      label,
    },
  });
  if (created.error || !created.data?.user?.id) {
    throw new Error(`disposable user create failed (${label})`);
  }
  return created.data.user.id;
}

export async function sessionFor(url, anonKey, admin, email, expectedId) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) {
    throw new Error("session link generation failed");
  }
  const client = anonClient(url, anonKey);
  const verified = await client.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
  if (verified.error || !verified.data?.session) {
    throw new Error("session exchange failed");
  }
  const who = await client.auth.getUser();
  if (who.error || who.data.user?.id !== expectedId) {
    throw new Error("session does not match the disposable user");
  }
  return client;
}

/** Safe delete helper that records PostgREST errors into cleanupFailures. */
export async function trackedDelete(client, table, id, cleanupFailures, label) {
  if (!id) return;
  try {
    const res = await client.from(table).delete().eq("id", id).select("id");
    if (res.error) cleanupFailures.push(`${label}: ${res.error.code || "error"}`);
  } catch {
    cleanupFailures.push(`${label}: exception`);
  }
}
