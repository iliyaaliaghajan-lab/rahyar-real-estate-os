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


/** Safe delete helper that records PostgREST errors into cleanupFailures. */
async function trackedDelete(client, table, id, cleanupFailures, label) {
  if (!id) return;
  try {
    const res = await client.from(table).delete().eq("id", id).select("id");
    if (res.error) cleanupFailures.push(`${label}: ${res.error.code || "error"}`);
  } catch {
    cleanupFailures.push(`${label}: exception`);
  }
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

  // Snapshot values for read-back after negative mutations
  let propATitle = null;
  let actAText = null;

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
          title: (propATitle = `Prop A ${runId}`),
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
          text: (actAText = `Act A ${runId}`),
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
          text: `Act B ${runId}`,
          created_by: userIdB,
        })
        .select("id")
        .single();
      if (insActB.error || !insActB.data?.id) throw new Error("seed activity B failed");
      actB = insActB.data.id;

      record("SETUP", "PASS", `users+orgs+seeds ready run=${runId}`);
    } catch (e) {
      setupError = e instanceof Error ? e.message : "setup failed";
      record("SETUP", "FAIL", setupError);
    }

    if (setupError) {
      for (const id of [
        "T-SEL",
        "T-INS-OWN",
        "T-INS-CROSS",
        "T-INS-AUDIT",
        "T-FK-NEED",
        "T-FK-FU-CLIENT",
        "T-FK-FU-PROP",
        "T-UPD-OWN",
        "T-UPD-CROSS",
        "T-UPD-ORG",
        "T-UPD-CREATED-BY",
        "T-UPD-ACT",
        "T-DEL-CROSS",
        "T-DEL-OWN",
        "T-DEL-ACT",
        "T-ANON",
      ]) {
        record(id, "SKIP", "setup failed");
      }
    } else {
      // --- T-SEL: tenant isolation SELECT with positive own-row proof ---
      const seedIds = {
        properties: { A: propA, B: propB },
        clients: { A: clientA, B: clientB },
        needs: { A: needA, B: needB },
        follow_ups: { A: fuA, B: fuB },
        activities: { A: actA, B: actB },
      };
      const tables = ["properties", "clients", "needs", "follow_ups", "activities"];
      let selOk = true;
      let selDetail = "";
      for (const t of tables) {
        const resA = await clients.A.from(t).select("id,organization_id");
        if (resA.error) {
          selOk = false;
          selDetail = `Owner A select ${t} error`;
          break;
        }
        const rowsA = resA.data || [];
        const ownA = rowsA.filter((r) => r.id === seedIds[t].A);
        const foreignA = rowsA.filter((r) => r.organization_id === orgBId || r.id === seedIds[t].B);
        if (ownA.length !== 1) {
          selOk = false;
          selDetail = `Owner A missing own seed row in ${t}`;
          break;
        }
        if (foreignA.length > 0) {
          selOk = false;
          selDetail = `Owner A saw Org B / foreign seed in ${t}`;
          break;
        }

        const resB = await clients.B.from(t).select("id,organization_id");
        if (resB.error) {
          selOk = false;
          selDetail = `Owner B select ${t} error`;
          break;
        }
        const rowsB = resB.data || [];
        const ownB = rowsB.filter((r) => r.id === seedIds[t].B);
        const foreignB = rowsB.filter((r) => r.organization_id === orgAId || r.id === seedIds[t].A);
        if (ownB.length !== 1) {
          selOk = false;
          selDetail = `Owner B missing own seed row in ${t}`;
          break;
        }
        if (foreignB.length > 0) {
          selOk = false;
          selDetail = `Owner B saw Org A / foreign seed in ${t}`;
          break;
        }
      }
      if (selOk) record("T-SEL", "PASS", "own seed present; foreign absent");
      else record("T-SEL", "FAIL", selDetail);

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

      // --- T-INS-AUDIT: foreign created_by / updated_by on all audit tables ---
      const auditTargets = [
        {
          table: "properties",
          payload: {
            organization_id: orgAId,
            title: `bad-audit-prop ${runId}`,
            created_by: userIdB,
            updated_by: userIdB,
          },
        },
        {
          table: "clients",
          payload: {
            organization_id: orgAId,
            name: `bad-audit-client ${runId}`,
            created_by: userIdB,
            updated_by: userIdB,
          },
        },
        {
          table: "needs",
          payload: {
            organization_id: orgAId,
            client_id: clientA,
            created_by: userIdB,
            updated_by: userIdB,
          },
        },
        {
          table: "follow_ups",
          payload: {
            organization_id: orgAId,
            title: `bad-audit-fu ${runId}`,
            client_id: clientA,
            created_by: userIdB,
            updated_by: userIdB,
          },
        },
        {
          table: "activities",
          payload: {
            organization_id: orgAId,
            type: "client",
            text: `bad-audit-act ${runId}`,
            created_by: userIdB,
          },
        },
      ];
      let auditOk = true;
      let auditDetail = "";
      for (const target of auditTargets) {
        const res = await clients.A.from(target.table).insert(target.payload).select("id");
        if (!res.error) {
          const leaked = (res.data || [])[0]?.id;
          if (leaked) {
            await clients.A.from(target.table).delete().eq("id", leaked);
          }
          auditOk = false;
          auditDetail = `invalid audit insert succeeded on ${target.table}`;
          break;
        }
        const k = denialKind(res.error);
        if (k !== "permission" && k !== "trigger") {
          auditOk = false;
          auditDetail = `unexpected denial kind=${k} on ${target.table}`;
          break;
        }
      }
      if (auditOk) record("T-INS-AUDIT", "PASS", "invalid created_by/updated_by rejected");
      else record("T-INS-AUDIT", "FAIL", auditDetail);

      // --- T-FK-NEED: need must reference same-org client ---
      const fkNeed = await clients.A.from("needs").insert({
        organization_id: orgAId,
        client_id: clientB,
        created_by: userIdA,
        updated_by: userIdA,
      });
      {
        const k = denialKind(fkNeed.error);
        const code = String(fkNeed.error?.code || "");
        if (code === "23503" || k === "fk") {
          record("T-FK-NEED", "PASS", `FK violation code=${code || k}`);
        } else if (!fkNeed.error) {
          record("T-FK-NEED", "FAIL", "cross-org need insert succeeded");
        } else if (k === "permission") {
          record("T-FK-NEED", "FAIL", "got generic permission instead of FK");
        } else {
          record("T-FK-NEED", "FAIL", `unexpected kind=${k} code=${code}`);
        }
      }

      // --- T-FK-FU-CLIENT: follow_up client must be same org ---
      const fkFuClient = await clients.A.from("follow_ups").insert({
        organization_id: orgAId,
        title: `fk-fu-client ${runId}`,
        client_id: clientB,
        created_by: userIdA,
        updated_by: userIdA,
      });
      {
        const k = denialKind(fkFuClient.error);
        const code = String(fkFuClient.error?.code || "");
        if (code === "23503" || k === "fk" || k === "trigger") {
          record("T-FK-FU-CLIENT", "PASS", `denied code=${code || k}`);
        } else if (!fkFuClient.error) {
          record("T-FK-FU-CLIENT", "FAIL", "cross-org follow_up client insert succeeded");
        } else if (k === "permission") {
          record("T-FK-FU-CLIENT", "FAIL", "got generic permission instead of FK/trigger");
        } else {
          record("T-FK-FU-CLIENT", "FAIL", `unexpected kind=${k} code=${code}`);
        }
      }

      // --- T-FK-FU-PROP: follow_up property must be same org ---
      const fkFuProp = await clients.A.from("follow_ups").insert({
        organization_id: orgAId,
        title: `fk-fu-prop ${runId}`,
        client_id: clientA,
        property_id: propB,
        created_by: userIdA,
        updated_by: userIdA,
      });
      {
        const k = denialKind(fkFuProp.error);
        const code = String(fkFuProp.error?.code || "");
        if (code === "23503" || k === "fk" || k === "trigger") {
          record("T-FK-FU-PROP", "PASS", `denied code=${code || k}`);
        } else if (!fkFuProp.error) {
          record("T-FK-FU-PROP", "FAIL", "cross-org follow_up property insert succeeded");
        } else if (k === "permission") {
          record("T-FK-FU-PROP", "FAIL", "got generic permission instead of FK/trigger");
        } else {
          record("T-FK-FU-PROP", "FAIL", `unexpected kind=${k} code=${code}`);
        }
      }

      // --- T-UPD-OWN: own-tenant UPDATE ---
      const ownUpd = await clients.A
        .from("properties")
        .update({ title: `updated-own ${runId}`, updated_by: userIdA })
        .eq("id", propA)
        .select("id,title")
        .single();
      if (ownUpd.error || !ownUpd.data || ownUpd.data.title !== `updated-own ${runId}`) {
        record("T-UPD-OWN", "FAIL", "own UPDATE failed");
      } else {
        propATitle = ownUpd.data.title;
        record("T-UPD-OWN", "PASS", "own UPDATE ok");
      }

      // --- T-UPD-CROSS: cross-tenant UPDATE blocked + read-back ---
      const crossUpd = await clients.A
        .from("properties")
        .update({ title: "hacked-by-A" })
        .eq("id", propB)
        .select("id");
      let crossUpdPass = false;
      if (crossUpd.error) {
        const k = denialKind(crossUpd.error);
        if (k === "permission") crossUpdPass = true;
        else record("T-UPD-CROSS", "FAIL", `unexpected kind=${k}`);
      } else if ((crossUpd.data || []).length === 0) {
        crossUpdPass = true;
      } else {
        record("T-UPD-CROSS", "FAIL", "cross UPDATE modified foreign rows");
      }
      if (crossUpdPass) {
        const rb = await clients.B.from("properties").select("id,title").eq("id", propB).maybeSingle();
        if (rb.error || !rb.data || rb.data.title === "hacked-by-A") {
          record("T-UPD-CROSS", "FAIL", "read-back shows foreign title changed or missing");
        } else {
          record("T-UPD-CROSS", "PASS", "cross UPDATE blocked; read-back ok");
        }
      }

      // --- T-UPD-ORG: organization_id immutable ---
      const orgUpd = await clients.A
        .from("properties")
        .update({ organization_id: orgBId })
        .eq("id", propA)
        .select("id");
      let orgImmOk = false;
      if (orgUpd.error) {
        const k = denialKind(orgUpd.error);
        if (k === "permission" || k === "trigger") orgImmOk = true;
        else record("T-UPD-ORG", "FAIL", `unexpected kind=${k}`);
      } else if ((orgUpd.data || []).length === 0) {
        orgImmOk = true;
      } else {
        record("T-UPD-ORG", "FAIL", "organization_id change succeeded");
      }
      if (orgImmOk) {
        const rb = await clients.A.from("properties").select("id,organization_id").eq("id", propA).maybeSingle();
        if (rb.error || !rb.data || rb.data.organization_id !== orgAId) {
          record("T-UPD-ORG", "FAIL", "read-back organization_id wrong");
        } else {
          record("T-UPD-ORG", "PASS", "organization_id immutable");
        }
      }

      // --- T-UPD-CREATED-BY: created_by immutable ---
      const cbUpd = await clients.A
        .from("properties")
        .update({ created_by: userIdB })
        .eq("id", propA)
        .select("id");
      let cbImmOk = false;
      if (cbUpd.error) {
        const k = denialKind(cbUpd.error);
        if (k === "permission" || k === "trigger") cbImmOk = true;
        else record("T-UPD-CREATED-BY", "FAIL", `unexpected kind=${k}`);
      } else if ((cbUpd.data || []).length === 0) {
        cbImmOk = true;
      } else {
        record("T-UPD-CREATED-BY", "FAIL", "created_by change succeeded");
      }
      if (cbImmOk) {
        const rb = await clients.A.from("properties").select("id,created_by").eq("id", propA).maybeSingle();
        if (rb.error || !rb.data || rb.data.created_by !== userIdA) {
          record("T-UPD-CREATED-BY", "FAIL", "read-back created_by wrong");
        } else {
          record("T-UPD-CREATED-BY", "PASS", "created_by immutable");
        }
      }

      // --- T-UPD-ACT: activities no UPDATE + read-back ---
      const actUpd = await clients.A
        .from("activities")
        .update({ text: "mutated" })
        .eq("id", actA)
        .select("id");
      let actUpdBlocked = false;
      if (actUpd.error) {
        const k = denialKind(actUpd.error);
        if (k === "permission") actUpdBlocked = true;
        else record("T-UPD-ACT", "FAIL", `activities UPDATE unexpected kind=${k}`);
      } else if ((actUpd.data || []).length === 0) {
        actUpdBlocked = true;
      } else {
        record("T-UPD-ACT", "FAIL", "activities UPDATE succeeded");
      }
      if (actUpdBlocked) {
        const rb = await clients.A.from("activities").select("id,text").eq("id", actA).maybeSingle();
        if (rb.error || !rb.data || rb.data.text !== actAText) {
          record("T-UPD-ACT", "FAIL", "read-back shows activity text changed or missing");
        } else {
          record("T-UPD-ACT", "PASS", "act UPDATE blocked; text ok");
        }
      }

      // --- T-DEL-CROSS: cross-tenant DELETE + read-back ---
      const crossDel = await clients.A.from("properties").delete().eq("id", propB).select("id");
      let delCrossPass = false;
      if (crossDel.error) {
        const k = denialKind(crossDel.error);
        if (k === "permission") delCrossPass = true;
        else record("T-DEL-CROSS", "FAIL", `cross-tenant DELETE unexpected kind=${k}`);
      } else if ((crossDel.data || []).length === 0) {
        delCrossPass = true;
      } else {
        record("T-DEL-CROSS", "FAIL", "cross-tenant DELETE removed foreign rows");
      }
      if (delCrossPass) {
        const rb = await clients.B.from("properties").select("id").eq("id", propB).maybeSingle();
        if (rb.error || !rb.data) {
          record("T-DEL-CROSS", "FAIL", "read-back shows prop B missing after cross DELETE attempt");
        } else {
          record("T-DEL-CROSS", "PASS", "cross DELETE blocked; read-back ok");
        }
      }

      // --- T-DEL-OWN: own-tenant DELETE on independent rows for all 4 editable tables ---
      let delOwnOk = true;
      let delOwnDetail = "";
      try {
        const dClient = await clients.A
          .from("clients")
          .insert({
            organization_id: orgAId,
            name: `del-client ${runId}`,
            created_by: userIdA,
            updated_by: userIdA,
          })
          .select("id")
          .single();
        if (dClient.error || !dClient.data?.id) throw new Error("disposable client create failed");

        const dProp = await clients.A
          .from("properties")
          .insert({
            organization_id: orgAId,
            title: `del-prop ${runId}`,
            created_by: userIdA,
            updated_by: userIdA,
          })
          .select("id")
          .single();
        if (dProp.error || !dProp.data?.id) throw new Error("disposable property create failed");

        const dNeed = await clients.A
          .from("needs")
          .insert({
            organization_id: orgAId,
            client_id: dClient.data.id,
            created_by: userIdA,
            updated_by: userIdA,
          })
          .select("id")
          .single();
        if (dNeed.error || !dNeed.data?.id) throw new Error("disposable need create failed");

        const dFu = await clients.A
          .from("follow_ups")
          .insert({
            organization_id: orgAId,
            title: `del-fu ${runId}`,
            client_id: dClient.data.id,
            property_id: dProp.data.id,
            created_by: userIdA,
            updated_by: userIdA,
          })
          .select("id")
          .single();
        if (dFu.error || !dFu.data?.id) throw new Error("disposable follow_up create failed");

        for (const [table, id] of [
          ["follow_ups", dFu.data.id],
          ["needs", dNeed.data.id],
          ["properties", dProp.data.id],
          ["clients", dClient.data.id],
        ]) {
          const del = await clients.A.from(table).delete().eq("id", id).select("id");
          if (del.error || (del.data || []).length !== 1) {
            delOwnOk = false;
            delOwnDetail = `own DELETE failed on ${table}`;
            break;
          }
        }
      } catch (e) {
        delOwnOk = false;
        delOwnDetail = e instanceof Error ? e.message : "disposable delete setup failed";
      }
      if (delOwnOk) record("T-DEL-OWN", "PASS", "own DELETE ok on 4 tables");
      else record("T-DEL-OWN", "FAIL", delOwnDetail);

      // --- T-DEL-ACT: activities no DELETE + read-back ---
      const actDel = await clients.A.from("activities").delete().eq("id", actA).select("id");
      let actDelBlocked = false;
      if (actDel.error) {
        const k = denialKind(actDel.error);
        if (k === "permission") actDelBlocked = true;
        else record("T-DEL-ACT", "FAIL", `activities DELETE unexpected kind=${k}`);
      } else if ((actDel.data || []).length === 0) {
        actDelBlocked = true;
      } else {
        record("T-DEL-ACT", "FAIL", "activities DELETE succeeded");
      }
      if (actDelBlocked) {
        const rb = await clients.A.from("activities").select("id").eq("id", actA).maybeSingle();
        if (rb.error || !rb.data) {
          record("T-DEL-ACT", "FAIL", "read-back shows activity missing after DELETE attempt");
        } else {
          record("T-DEL-ACT", "PASS", "act DELETE blocked; read-back ok");
        }
      }

      // --- T-ANON: anon key cannot read business tables ---
      const anon = anonClient(url, anonKey);
      let anonOk = true;
      let anonDetail = "";
      for (const t of tables) {
        const res = await anon.from(t).select("id").limit(1);
        if (!res.error && (res.data || []).length > 0) {
          anonOk = false;
          anonDetail = `anon read returned rows on ${t}`;
          break;
        }
        if (res.error) {
          const k = denialKind(res.error);
          if (k !== "auth" && k !== "permission") {
            anonOk = false;
            anonDetail = `anon unexpected kind=${k} on ${t}`;
            break;
          }
        }
      }
      if (anonOk) record("T-ANON", "PASS", "anon denied on all tables");
      else record("T-ANON", "FAIL", anonDetail);
    }
  } finally {
    const cleanupFailures = [];
    try {
      // Prefer user JWT deletes for own-tenant rows, then service-role org wipe.
      if (clients.A && orgAId) {
        for (const [table, id] of [
          ["follow_ups", fuA],
          ["needs", needA],
          ["properties", propA],
          ["clients", clientA],
        ]) {
          await trackedDelete(clients.A, table, id, cleanupFailures, `A.${table}`);
        }
      }
      if (clients.B && orgBId) {
        for (const [table, id] of [
          ["follow_ups", fuB],
          ["needs", needB],
          ["properties", propB],
          ["clients", clientB],
        ]) {
          await trackedDelete(clients.B, table, id, cleanupFailures, `B.${table}`);
        }
      }

      // Org delete (service role) cascades memberships and remaining rows including activities.
      if (orgAId) {
        const delOrgA = await admin.from("organizations").delete().eq("id", orgAId).select("id");
        if (delOrgA.error) cleanupFailures.push(`orgA: ${delOrgA.error.code || "error"}`);
      }
      if (orgBId) {
        const delOrgB = await admin.from("organizations").delete().eq("id", orgBId).select("id");
        if (delOrgB.error) cleanupFailures.push(`orgB: ${delOrgB.error.code || "error"}`);
      }

      // Residual org name check
      for (const name of orgNames) {
        const residual = await admin.from("organizations").select("id,name").eq("name", name);
        if (residual.error) {
          cleanupFailures.push(`residual-org-query ${name}: ${residual.error.code || "error"}`);
        } else if ((residual.data || []).length > 0) {
          cleanupFailures.push(`residual org name still present: ${name}`);
        }
      }

      // Delete disposable users
      for (const uid of userIds) {
        try {
          const delUser = await admin.auth.admin.deleteUser(uid);
          if (delUser.error) cleanupFailures.push(`user ${uid}: ${delUser.error.message || "error"}`);
        } catch {
          cleanupFailures.push(`user ${uid}: exception`);
        }
      }
    } catch (e) {
      cleanupFailures.push(e instanceof Error ? e.message : "cleanup exception");
    }

    if (cleanupFailures.length > 0) {
      cleanupFailed = true;
      record("CLEANUP", "FAIL", cleanupFailures.join("; ") + ` run=${runId}`);
    } else {
      record("CLEANUP", "PASS", `run=${runId} residual-clear");
    }
  }

  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");
  console.log(`summary pass=${passed.length} fail=${failed.length} total=${results.length}`);
  if (failed.length > 0 || cleanupFailed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "runner failed");
  process.exit(1);
});
