/**
 * Opt-in Staging JWT + Data API + RLS smoke for cloud business tables (Migration 009).
 * Not part of CI. Refuses to run unless pinned to the Staging project.
 * Service role is used only to provision and delete disposable users/orgs.
 * Access-control assertions use the anon key plus a real user session JWT.
 *
 * Tables under test: properties, clients, needs, follow_ups, activities.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const STAGING_ORIGIN = "https://dezonafotwyvvghbccko.supabase.co";
const STAGING_CONFIRM = "dezonafotwyvvghbccko";
const PRODUCTION_REF = "gguvmewknanhzukugvpj";

const results = [];

function record(id, status, detail) {
  results.push({ id, status, detail });
  console.log(`${status} ${id} — ${detail}`);
}

function refusal(message) {
  console.error(message);
  process.exit(1);
}

function loadConfig() {
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
function jwtRoleClaim(token) {
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

function denialKind(error) {
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

function anonClient(url, anonKey) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function createDisposable(admin, email, runId, label) {
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

async function sessionFor(url, anonKey, admin, email, expectedId) {
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

async function main() {
  const { url, anonKey, serviceKey } = loadConfig();
  const runId = randomBytes(6).toString("hex");
  console.log(`staging-cloud-data-jwt-smoke run ${runId} target=pinned-staging`);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userIds = [];
  const orgNames = new Set();
  const orgNameA = `cd-${runId}-org-a`;
  const orgNameB = `cd-${runId}-org-b`;
  orgNames.add(orgNameA);
  orgNames.add(orgNameB);

  const emails = {
    A: `cd-${runId}-a@etehad-staging.test`,
    B: `cd-${runId}-b@etehad-staging.test`,
  };

  /** @type {Record<string, import('@supabase/supabase-js').SupabaseClient>} */
  let clients = {};
  let userIdA = null;
  let userIdB = null;
  let orgAId = null;
  let orgBId = null;
  let setupError = null;
  let cleanupFailed = false;

  // Seeded row ids for assertions
  let propA = null;
  let propB = null;
  let clientA = null;
  let clientB = null;
  let needA = null;
  let needB = null;
  let fuA = null;
  let fuB = null;
  let actA = null;
  let actB = null;

  try {
    try {
      userIdA = await createDisposable(admin, emails.A, runId, "A");
      userIds.push(userIdA);
      userIdB = await createDisposable(admin, emails.B, runId, "B");
      userIds.push(userIdB);

      clients.A = await sessionFor(url, anonKey, admin, emails.A, userIdA);
      clients.B = await sessionFor(url, anonKey, admin, emails.B, userIdB);

      const createdA = await clients.A.rpc("create_organization_with_owner", { p_name: orgNameA });
      const rowA = Array.isArray(createdA.data) ? createdA.data[0] : createdA.data;
      if (createdA.error || !rowA?.organization_id) {
        throw new Error("owner A organization create failed");
      }
      orgAId = rowA.organization_id;

      const createdB = await clients.B.rpc("create_organization_with_owner", { p_name: orgNameB });
      const rowB = Array.isArray(createdB.data) ? createdB.data[0] : createdB.data;
      if (createdB.error || !rowB?.organization_id) {
        throw new Error("owner B organization create failed");
      }
      orgBId = rowB.organization_id;

      // Seed own-tenant rows via JWT clients (not service role)
      const insClientA = await clients.A
        .from("clients")
        .insert({
          organization_id: orgAId,
          name: `Client A ${runId}`,
          created_by: userIdA,
          updated_by: userIdA,
        })
        .select("id")
        .single();
      if (insClientA.error || !insClientA.data?.id) throw new Error("seed client A failed");
      clientA = insClientA.data.id;

      const insClientB = await clients.B
        .from("clients")
        .insert({
          organization_id: orgBId,
          name: `Client B ${runId}`,
          created_by: userIdB,
          updated_by: userIdB,
        })
        .select("id")
        .single();
      if (insClientB.error || !insClientB.data?.id) throw new Error("seed client B failed");
      clientB = insClientB.data.id;

      const insPropA = await clients.A
        .from("properties")
        .insert({
          organization_id: orgAId,
          title: `Prop A ${runId}`,
          created_by: userIdA,
          updated_by: userIdA,
        })
        .select("id")
        .single();
      if (insPropA.error || !insPropA.data?.id) throw new Error("seed property A failed");
      propA = insPropA.data.id;

      const insPropB = await clients.B
        .from("properties")
        .insert({
          organization_id: orgBId,
          title: `Prop B ${runId}`,
          created_by: userIdB,
          updated_by: userIdB,
        })
        .select("id")
        .single();
      if (insPropB.error || !insPropB.data?.id) throw new Error("seed property B failed");
      propB = insPropB.data.id;

      const insNeedA = await clients.A
        .from("needs")
        .insert({
          organization_id: orgAId,
          client_id: clientA,
          created_by: userIdA,
          updated_by: userIdA,
        })
        .select("id")
        .single();
      if (insNeedA.error || !insNeedA.data?.id) throw new Error("seed need A failed");
      needA = insNeedA.data.id;

      const insNeedB = await clients.B
        .from("needs")
        .insert({
          organization_id: orgBId,
          client_id: clientB,
          created_by: userIdB,
          updated_by: userIdB,
        })
        .select("id")
        .single();
      if (insNeedB.error || !insNeedB.data?.id) throw new Error("seed need B failed");
      needB = insNeedB.data.id;

      const insFuA = await clients.A
        .from("follow_ups")
        .insert({
          organization_id: orgAId,
          title: `FU A ${runId}`,
          client_id: clientA,
          property_id: propA,
          created_by: userIdA,
          updated_by: userIdA,
        })
        .select("id")
        .single();
      if (insFuA.error || !insFuA.data?.id) throw new Error("seed follow_up A failed");
      fuA = insFuA.data.id;

      const insFuB = await clients.B
        .from("follow_ups")
        .insert({
          organization_id: orgBId,
          title: `FU B ${runId}`,
          client_id: clientB,
          property_id: propB,
          created_by: userIdB,
          updated_by: userIdB,
        })
        .select("id")
        .single();
      if (insFuB.error || !insFuB.data?.id) throw new Error("seed follow_up B failed");
      fuB = insFuB.data.id;

      const insActA = await clients.A
        .from("activities")
        .insert({
          organization_id: orgAId,
          type: "client",
          text: `act A ${runId}`,
          created_by: userIdA,
        })
        .select("id")
        .single();
      if (insActA.error || !insActA.data?.id) throw new Error("seed activity A failed");
      actA = insActA.data.id;

      const insActB = await clients.B
        .from("activities")
        .insert({
          organization_id: orgBId,
          type: "client",
          text: `act B ${runId}`,
          created_by: userIdB,
        })
        .select("id")
        .single();
      if (insActB.error || !insActB.data?.id) throw new Error("seed activity B failed");
      actB = insActB.data.id;
    } catch (err) {
      setupError = err instanceof Error ? err.message : "setup failed";
      console.error(`SETUP FAIL — ${setupError}`);
    }

    const skip = (id, why) => record(id, "SKIP", why);

    if (setupError) {
      for (const id of [
        "T-SEL",
        "T-INS-OWN",
        "T-INS-CROSS",
        "T-INS-AUDIT",
        "T-UPD-CROSS",
        "T-UPD-ORG",
        "T-UPD-CREATED",
        "T-UPD-ACT",
        "T-DEL-CROSS",
        "T-DEL-OWN",
        "T-DEL-ACT",
        "T-FK-NEED",
        "T-FK-FU-CLIENT",
        "T-FK-FU-PROP",
        "T-ACT-READ",
        "T-ANON",
      ]) {
        skip(id, "setup failed");
      }
    } else {
      // --- T-SEL: tenant isolation SELECT ---
      const tables = ["properties", "clients", "needs", "follow_ups", "activities"];
      let selOk = true;
      for (const t of tables) {
        const resA = await clients.A.from(t).select("id,organization_id");
        if (resA.error) {
          record("T-SEL", "FAIL", `Owner A select ${t} error`);
          selOk = false;
          break;
        }
        const rowsA = resA.data || [];
        const foreignA = rowsA.filter((r) => r.organization_id === orgBId);
        if (foreignA.length > 0) {
          record("T-SEL", "FAIL", `Owner A saw Org B rows in ${t}`);
          selOk = false;
          break;
        }
        const resB = await clients.B.from(t).select("id,organization_id");
        if (resB.error) {
          record("T-SEL", "FAIL", `Owner B select ${t} error`);
          selOk = false;
          break;
        }
        const foreignB = (resB.data || []).filter((r) => r.organization_id === orgAId);
        if (foreignB.length > 0) {
          record("T-SEL", "FAIL", `Owner B saw Org A rows in ${t}`);
          selOk = false;
          break;
        }
      }
      if (selOk) record("T-SEL", "PASS", "each owner sees only own-tenant rows across five tables");

      // --- T-INS-OWN: own-tenant INSERT already proven by seed; re-assert one more property ---
      const ownIns = await clients.A
        .from("properties")
        .insert({
          organization_id: orgAId,
          title: `own-extra ${runId}`,
          created_by: userIdA,
          updated_by: userIdA,
        })
        .select("id")
        .single();
      if (ownIns.error || !ownIns.data?.id) {
        record("T-INS-OWN", "FAIL", "own-tenant property insert failed");
      } else {
        // cleanup the extra row immediately via same JWT
        await clients.A.from("properties").delete().eq("id", ownIns.data.id);
        record("T-INS-OWN", "PASS", "own-tenant INSERT succeeded");
      }

      // --- T-INS-CROSS: cross-tenant INSERT rejected ---
      const crossIns = await clients.A.from("properties").insert({
        organization_id: orgBId,
        title: `cross ${runId}`,
        created_by: userIdA,
        updated_by: userIdA,
      });
      const crossKind = denialKind(crossIns.error);
      if (crossKind === "permission") {
        record("T-INS-CROSS", "PASS", "cross-tenant INSERT denied by RLS");
      } else if (!crossIns.error) {
        record("T-INS-CROSS", "FAIL", "cross-tenant INSERT succeeded");
      } else {
        record("T-INS-CROSS", "FAIL", `unexpected denial kind=${crossKind}`);
      }

      // --- T-INS-AUDIT: created_by / updated_by must match auth.uid() ---
      const badAudit = await clients.A.from("properties").insert({
        organization_id: orgAId,
        title: `bad-audit ${runId}`,
        created_by: userIdB,
        updated_by: userIdB,
      });
      const auditKind = denialKind(badAudit.error);
      if (auditKind === "permission") {
        record("T-INS-AUDIT", "PASS", "INSERT with foreign created_by/updated_by denied");
      } else if (!badAudit.error) {
        record("T-INS-AUDIT", "FAIL", "INSERT with foreign audit columns succeeded");
      } else {
        record("T-INS-AUDIT", "FAIL", `unexpected denial kind=${auditKind}`);
      }

      // --- T-UPD-CROSS: cross-tenant UPDATE affects 0 rows ---
      const crossUpd = await clients.A
        .from("properties")
        .update({ title: "hijacked", updated_by: userIdA })
        .eq("id", propB)
        .select("id");
      if (crossUpd.error) {
        const k = denialKind(crossUpd.error);
        if (k === "permission") record("T-UPD-CROSS", "PASS", "cross-tenant UPDATE denied");
        else record("T-UPD-CROSS", "FAIL", `cross-tenant UPDATE error kind=${k}`);
      } else if ((crossUpd.data || []).length === 0) {
        record("T-UPD-CROSS", "PASS", "cross-tenant UPDATE affected 0 rows");
      } else {
        record("T-UPD-CROSS", "FAIL", "cross-tenant UPDATE modified foreign rows");
      }

      // --- T-UPD-ORG: organization_id immutability ---
      const orgMove = await clients.A
        .from("properties")
        .update({ organization_id: orgBId, updated_by: userIdA })
        .eq("id", propA)
        .select("id,organization_id");
      if (orgMove.error) {
        const k = denialKind(orgMove.error);
        if (k === "trigger" || k === "permission") {
          record("T-UPD-ORG", "PASS", `organization_id change blocked (${k})`);
        } else {
          record("T-UPD-ORG", "FAIL", `unexpected denial kind=${k}`);
        }
      } else if ((orgMove.data || []).length === 0) {
        record("T-UPD-ORG", "PASS", "organization_id change affected 0 rows");
      } else {
        const finalOrg = orgMove.data[0]?.organization_id;
        if (finalOrg === orgAId) {
          record("T-UPD-ORG", "PASS", "organization_id remained unchanged");
        } else {
          record("T-UPD-ORG", "FAIL", "organization_id was changed");
        }
      }

      // --- T-UPD-CREATED: created_by immutability ---
      const cbMove = await clients.A
        .from("properties")
        .update({ created_by: userIdB, updated_by: userIdA })
        .eq("id", propA)
        .select("id,created_by");
      if (cbMove.error) {
        const k = denialKind(cbMove.error);
        if (k === "trigger" || k === "permission") {
          record("T-UPD-CREATED", "PASS", `created_by change blocked (${k})`);
        } else {
          record("T-UPD-CREATED", "FAIL", `unexpected denial kind=${k}`);
        }
      } else if ((cbMove.data || []).length === 0) {
        record("T-UPD-CREATED", "PASS", "created_by change affected 0 rows");
      } else {
        const finalCb = cbMove.data[0]?.created_by;
        if (finalCb === userIdA) {
          record("T-UPD-CREATED", "PASS", "created_by remained unchanged");
        } else {
          record("T-UPD-CREATED", "FAIL", "created_by was changed");
        }
      }

      // --- T-UPD-ACT: activities have no UPDATE privilege ---
      const actUpd = await clients.A
        .from("activities")
        .update({ text: "mutated" })
        .eq("id", actA)
        .select("id");
      if (actUpd.error) {
        const k = denialKind(actUpd.error);
        if (k === "permission") record("T-UPD-ACT", "PASS", "activities UPDATE denied");
        else record("T-UPD-ACT", "FAIL", `activities UPDATE unexpected kind=${k}`);
      } else if ((actUpd.data || []).length === 0) {
        // PostgREST may return empty on no privilege depending on grants
        record("T-UPD-ACT", "PASS", "activities UPDATE affected 0 rows (no privilege)");
      } else {
        record("T-UPD-ACT", "FAIL", "activities UPDATE succeeded");
      }

      // --- T-DEL-CROSS: cross-tenant DELETE affects 0 ---
      const crossDel = await clients.A.from("properties").delete().eq("id", propB).select("id");
      if (crossDel.error) {
        const k = denialKind(crossDel.error);
        if (k === "permission") record("T-DEL-CROSS", "PASS", "cross-tenant DELETE denied");
        else record("T-DEL-CROSS", "FAIL", `cross-tenant DELETE unexpected kind=${k}`);
      } else if ((crossDel.data || []).length === 0) {
        record("T-DEL-CROSS", "PASS", "cross-tenant DELETE affected 0 rows");
      } else {
        record("T-DEL-CROSS", "FAIL", "cross-tenant DELETE removed foreign rows");
      }

      // --- T-DEL-OWN: own-tenant DELETE on a disposable property ---
      const tempProp = await clients.A
        .from("properties")
        .insert({
          organization_id: orgAId,
          title: `del-me ${runId}`,
          created_by: userIdA,
          updated_by: userIdA,
        })
        .select("id")
        .single();
      if (tempProp.error || !tempProp.data?.id) {
        record("T-DEL-OWN", "FAIL", "could not create disposable property for delete test");
      } else {
        const del = await clients.A.from("properties").delete().eq("id", tempProp.data.id).select("id");
        if (del.error) {
          record("T-DEL-OWN", "FAIL", "own-tenant DELETE failed");
        } else if ((del.data || []).length === 1) {
          record("T-DEL-OWN", "PASS", "own-tenant DELETE succeeded");
        } else {
          record("T-DEL-OWN", "FAIL", "own-tenant DELETE affected unexpected row count");
        }
      }

      // --- T-DEL-ACT: activities have no DELETE privilege ---
      const actDel = await clients.A.from("activities").delete().eq("id", actA).select("id");
      if (actDel.error) {
        const k = denialKind(actDel.error);
        if (k === "permission") record("T-DEL-ACT", "PASS", "activities DELETE denied");
        else record("T-DEL-ACT", "FAIL", `activities DELETE unexpected kind=${k}`);
      } else if ((actDel.data || []).length === 0) {
        record("T-DEL-ACT", "PASS", "activities DELETE affected 0 rows (no privilege)");
      } else {
        record("T-DEL-ACT", "FAIL", "activities DELETE succeeded");
      }

      // --- T-FK-NEED: needs cannot reference foreign client ---
      const fkNeed = await clients.A.from("needs").insert({
        organization_id: orgAId,
        client_id: clientB,
        created_by: userIdA,
        updated_by: userIdA,
      });
      const fkNeedKind = denialKind(fkNeed.error);
      if (fkNeedKind === "fk" || fkNeedKind === "permission") {
        record("T-FK-NEED", "PASS", `cross-org need client blocked (${fkNeedKind})`);
      } else if (!fkNeed.error) {
        record("T-FK-NEED", "FAIL", "cross-org need client insert succeeded");
      } else {
        record("T-FK-NEED", "FAIL", `unexpected denial kind=${fkNeedKind}`);
      }

      // --- T-FK-FU-CLIENT: follow_ups cannot reference foreign client ---
      const fkFuClient = await clients.A.from("follow_ups").insert({
        organization_id: orgAId,
        title: `bad-client ${runId}`,
        client_id: clientB,
        created_by: userIdA,
        updated_by: userIdA,
      });
      const fkFuCKind = denialKind(fkFuClient.error);
      if (fkFuCKind === "fk" || fkFuCKind === "permission") {
        record("T-FK-FU-CLIENT", "PASS", `cross-org follow_up client blocked (${fkFuCKind})`);
      } else if (!fkFuClient.error) {
        record("T-FK-FU-CLIENT", "FAIL", "cross-org follow_up client insert succeeded");
      } else {
        record("T-FK-FU-CLIENT", "FAIL", `unexpected denial kind=${fkFuCKind}`);
      }

      // --- T-FK-FU-PROP: follow_ups cannot reference foreign property ---
      const fkFuProp = await clients.A.from("follow_ups").insert({
        organization_id: orgAId,
        title: `bad-prop ${runId}`,
        client_id: clientA,
        property_id: propB,
        created_by: userIdA,
        updated_by: userIdA,
      });
      const fkFuPKind = denialKind(fkFuProp.error);
      if (fkFuPKind === "trigger" || fkFuPKind === "fk" || fkFuPKind === "permission") {
        record("T-FK-FU-PROP", "PASS", `cross-org follow_up property blocked (${fkFuPKind})`);
      } else if (!fkFuProp.error) {
        record("T-FK-FU-PROP", "FAIL", "cross-org follow_up property insert succeeded");
      } else {
        record("T-FK-FU-PROP", "FAIL", `unexpected denial kind=${fkFuPKind}`);
      }

      // --- T-ACT-READ: activities readable only in own org ---
      const actReadA = await clients.A.from("activities").select("id,organization_id");
      if (actReadA.error) {
        record("T-ACT-READ", "FAIL", "Owner A could not read activities");
      } else {
        const foreign = (actReadA.data || []).filter((r) => r.organization_id === orgBId);
        if (foreign.length > 0) {
          record("T-ACT-READ", "FAIL", "Owner A saw Org B activities");
        } else {
          const own = (actReadA.data || []).filter((r) => r.id === actA);
          if (own.length === 1) record("T-ACT-READ", "PASS", "activities SELECT scoped to own org");
          else record("T-ACT-READ", "FAIL", "own activity not visible to owner");
        }
      }

      // --- T-ANON: unauthenticated access must be denied (not empty success) ---
      const bare = anonClient(url, anonKey);
      let anonOk = true;
      for (const t of tables) {
        const res = await bare.from(t).select("id").limit(1);
        if (!res.error) {
          // Empty data without error is NOT sufficient proof of denial
          record("T-ANON", "FAIL", `anon select on ${t} returned without error`);
          anonOk = false;
          break;
        }
        const k = denialKind(res.error);
        if (k !== "permission" && k !== "auth") {
          record("T-ANON", "FAIL", `anon select on ${t} unexpected kind=${k}`);
          anonOk = false;
          break;
        }
      }
      if (anonOk) record("T-ANON", "PASS", "anon access denied with permission/auth error on all five tables");
    }
  } finally {
    const cleanupFailures = [];
    // Prefer JWT clients for business-row cleanup when sessions still exist
    if (!setupError && clients.A && clients.B) {
      for (const [client, rows] of [
        [clients.A, { prop: propA, client: clientA, need: needA, fu: fuA }],
        [clients.B, { prop: propB, client: clientB, need: needB, fu: fuB }],
      ]) {
        try {
          if (rows.fu) await client.from("follow_ups").delete().eq("id", rows.fu);
        } catch {
          cleanupFailures.push("follow_ups delete");
        }
        try {
          if (rows.need) await client.from("needs").delete().eq("id", rows.need);
        } catch {
          cleanupFailures.push("needs delete");
        }
        try {
          if (rows.prop) await client.from("properties").delete().eq("id", rows.prop);
        } catch {
          cleanupFailures.push("properties delete");
        }
        try {
          if (rows.client) await client.from("clients").delete().eq("id", rows.client);
        } catch {
          cleanupFailures.push("clients delete");
        }
      }
      // activities: no DELETE privilege for authenticated — leave for org cascade
    }

    if (orgNames.size > 0) {
      try {
        const found = await admin.from("organizations").select("id,name").in("name", [...orgNames]);
        if (found.error) {
          cleanupFailures.push("organization lookup");
        } else {
          for (const row of found.data || []) {
            if (!orgNames.has(row.name)) continue;
            try {
              const removed = await admin.from("organizations").delete().eq("id", row.id);
              if (removed.error) cleanupFailures.push("organization delete");
            } catch {
              cleanupFailures.push("organization delete");
            }
          }
        }
      } catch {
        cleanupFailures.push("organization lookup");
      }
    }
    for (const id of userIds) {
      try {
        const removed = await admin.auth.admin.deleteUser(id);
        if (removed.error) cleanupFailures.push("auth user delete");
      } catch {
        cleanupFailures.push("auth user delete");
      }
    }
    if (cleanupFailures.length === 0) {
      console.log(`CLEANUP OK run ${runId}`);
    } else {
      cleanupFailed = true;
      const kinds = [...new Set(cleanupFailures)].join(", ");
      console.error(
        `CLEANUP FAIL run ${runId} kinds=${kinds} — disposable rows may remain; delete only this run id manually in Staging.`,
      );
    }
  }

  const failed = results.some((item) => item.status === "FAIL");
  const summary = results.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { PASS: 0, FAIL: 0, SKIP: 0 },
  );
  console.log(`SUMMARY pass=${summary.PASS} fail=${summary.FAIL} skip=${summary.SKIP} run=${runId}`);
  if (setupError || failed || cleanupFailed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "runner failed");
  process.exit(1);
});
