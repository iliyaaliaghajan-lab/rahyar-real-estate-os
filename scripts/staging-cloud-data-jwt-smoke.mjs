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
          text: (actAText = `act A ${runId}`),
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
          if (leaked && target.table !== "activities") {
            await clients.A.from(target.table).delete().eq("id", leaked);
          }
          auditOk = false;
          auditDetail = `${target.table} accepted foreign audit columns`;
          break;
        }
        const k = denialKind(res.error);
        if (k !== "permission") {
          auditOk = false;
          auditDetail = `${target.table} unexpected denial kind=${k}`;
          break;
        }
      }
      if (auditOk) {
        record("T-INS-AUDIT", "PASS", "foreign audit denied on 5 tables");
      } else {
        record("T-INS-AUDIT", "FAIL", auditDetail);
      }

      // --- T-UPD-CROSS: cross-tenant UPDATE + read-back ---
      const crossUpd = await clients.A
        .from("properties")
        .update({ title: "hijacked", updated_by: userIdA })
        .eq("id", propB)
        .select("id");
      let updCrossPass = false;
      if (crossUpd.error) {
        const k = denialKind(crossUpd.error);
        if (k === "permission") updCrossPass = true;
        else record("T-UPD-CROSS", "FAIL", `cross-tenant UPDATE error kind=${k}`);
      } else if ((crossUpd.data || []).length === 0) {
        updCrossPass = true;
      } else {
        record("T-UPD-CROSS", "FAIL", "cross-tenant UPDATE modified foreign rows");
      }
      if (updCrossPass) {
        const rb = await clients.B.from("properties").select("id,title").eq("id", propB).maybeSingle();
        if (rb.error || !rb.data || rb.data.title === "hijacked") {
          record("T-UPD-CROSS", "FAIL", "read-back shows prop B was altered or missing");
        } else {
          record("T-UPD-CROSS", "PASS", "cross UPDATE blocked; read-back ok");
        }
      }

      // --- T-UPD-ORG: organization_id immutability + read-back ---
      const orgMove = await clients.A
        .from("properties")
        .update({ organization_id: orgBId, updated_by: userIdA })
        .eq("id", propA)
        .select("id,organization_id");
      let orgPass = false;
      if (orgMove.error) {
        const k = denialKind(orgMove.error);
        if (k === "trigger" || k === "permission") orgPass = true;
        else record("T-UPD-ORG", "FAIL", `unexpected denial kind=${k}`);
      } else if ((orgMove.data || []).length === 0) {
        orgPass = true;
      } else if (orgMove.data[0]?.organization_id === orgAId) {
        orgPass = true;
      } else {
        record("T-UPD-ORG", "FAIL", "organization_id was changed");
      }
      if (orgPass) {
        const rb = await clients.A.from("properties").select("id,organization_id").eq("id", propA).maybeSingle();
        if (rb.error || !rb.data || rb.data.organization_id !== orgAId) {
          record("T-UPD-ORG", "FAIL", "read-back shows organization_id changed or missing");
        } else {
          record("T-UPD-ORG", "PASS", "org_id immutable; read-back ok");
        }
      }

      // --- T-UPD-CREATED: created_by immutability + read-back ---
      const cbMove = await clients.A
        .from("properties")
        .update({ created_by: userIdB, updated_by: userIdA })
        .eq("id", propA)
        .select("id,created_by");
      let cbPass = false;
      if (cbMove.error) {
        const k = denialKind(cbMove.error);
        if (k === "trigger" || k === "permission") cbPass = true;
        else record("T-UPD-CREATED", "FAIL", `unexpected denial kind=${k}`);
      } else if ((cbMove.data || []).length === 0) {
        cbPass = true;
      } else if (cbMove.data[0]?.created_by === userIdA) {
        cbPass = true;
      } else {
        record("T-UPD-CREATED", "FAIL", "created_by was changed");
      }
      if (cbPass) {
        const rb = await clients.A.from("properties").select("id,created_by").eq("id", propA).maybeSingle();
        if (rb.error || !rb.data || rb.data.created_by !== userIdA) {
          record("T-UPD-CREATED", "FAIL", "read-back shows created_by changed or missing");
        } else {
          record("T-UPD-CREATED", "PASS", "created_by immutable; read-back ok");
        }
      }

      // --- T-UPD-ACT: activities no UPDATE + read-back of original text ---
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
        const rb = await clients.A.from("activities").select("id,text").eq("id", actA).maybeSingle();
        if (rb.error || !rb.data || rb.data.text !== actAText) {
          record("T-DEL-ACT", "FAIL", "read-back shows activity missing or altered after DELETE attempt");
        } else {
          record("T-DEL-ACT", "PASS", "act DELETE blocked; row ok");
        }
      }

      // --- T-FK-NEED: needs cannot reference foreign client ---
      const fkNeed = await clients.A.from("needs").insert({
        organization_id: orgAId,
        client_id: clientB,
        created_by: userIdA,
        updated_by: userIdA,
      });
      const fkNeedKind = denialKind(fkNeed.error);
      if (fkNeedKind === "fk") {
        record("T-FK-NEED", "PASS", "need FK 23503");
      } else if (!fkNeed.error) {
        record("T-FK-NEED", "FAIL", "cross-org need client insert succeeded");
      } else {
        record("T-FK-NEED", "FAIL", `expected FK, got kind=${fkNeedKind}`);
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
      if (fkFuCKind === "fk") {
        record("T-FK-FU-CLIENT", "PASS", "fu client FK 23503");
      } else if (!fkFuClient.error) {
        record("T-FK-FU-CLIENT", "FAIL", "cross-org follow_up client insert succeeded");
      } else {
        record("T-FK-FU-CLIENT", "FAIL", `expected FK, got kind=${fkFuCKind}`);
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
      if (fkFuPKind === "trigger") {
        record("T-FK-FU-PROP", "PASS", "fu prop trigger 23514");
      } else if (fkFuPKind === "fk") {
        record("T-FK-FU-PROP", "PASS", "fu prop FK");
      } else if (!fkFuProp.error) {
        record("T-FK-FU-PROP", "FAIL", "cross-org follow_up property insert succeeded");
      } else {
        record("T-FK-FU-PROP", "FAIL", `expected trigger/FK, got kind=${fkFuPKind}`);
      }

      // --- T-ACT-READ: activities readable only in own org ---
      const actReadA = await clients.A.from("activities").select("id,organization_id");
      if (actReadA.error) {
        record("T-ACT-READ", "FAIL", "Owner A could not read activities");
      } else {
        const foreign = (actReadA.data || []).filter((r) => r.organization_id === orgBId || r.id === actB);
        const own = (actReadA.data || []).filter((r) => r.id === actA);
        if (foreign.length > 0) {
          record("T-ACT-READ", "FAIL", "Owner A saw Org B activities");
        } else if (own.length !== 1) {
          record("T-ACT-READ", "FAIL", "own activity not visible to owner");
        } else {
          record("T-ACT-READ", "PASS", "act SELECT own only");
        }
      }

      // --- T-ANON: unauthenticated access must be denied (not empty success) ---
      const bare = anonClient(url, anonKey);
      let anonOk = true;
      for (const t of tables) {
        const res = await bare.from(t).select("id").limit(1);
        if (!res.error) {
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
      if (anonOk) record("T-ANON", "PASS", "anon denied on 5 tables");
    }
  } finally {
    const cleanupFailures = [];

    // Prefer JWT clients for business-row cleanup when sessions still exist.
    // Order: follow_ups → needs → properties → clients (activities via org cascade).
    if (!setupError && clients.A && clients.B) {
      for (const [label, client, rows] of [
        ["A", clients.A, { prop: propA, client: clientA, need: needA, fu: fuA }],
        ["B", clients.B, { prop: propB, client: clientB, need: needB, fu: fuB }],
      ]) {
        await trackedDelete(client, "follow_ups", rows.fu, cleanupFailures, `follow_ups-${label}`);
        await trackedDelete(client, "needs", rows.need, cleanupFailures, `needs-${label}`);
        await trackedDelete(client, "properties", rows.prop, cleanupFailures, `properties-${label}`);
        await trackedDelete(client, "clients", rows.client, cleanupFailures, `clients-${label}`);
      }
      // activities: no DELETE privilege for authenticated — removed by organization CASCADE
    }

    if (orgNames.size > 0) {
      try {
        const found = await admin.from("organizations").select("id,name").in("name", [...orgNames]);
        if (found.error) {
          cleanupFailures.push(`organization lookup: ${found.error.code || "error"}`);
        } else {
          for (const row of found.data || []) {
            if (!orgNames.has(row.name)) continue;
            try {
              const removed = await admin.from("organizations").delete().eq("id", row.id).select("id");
              if (removed.error) {
                cleanupFailures.push(`organization delete: ${removed.error.code || "error"}`);
              }
            } catch {
              cleanupFailures.push("organization delete: exception");
            }
          }
          // Verify names from this run are gone
          try {
            const verify = await admin.from("organizations").select("id,name").in("name", [...orgNames]);
            if (verify.error) {
              cleanupFailures.push(`organization verify: ${verify.error.code || "error"}`);
            } else if ((verify.data || []).length > 0) {
              cleanupFailures.push(`organization residual names remain count=${verify.data.length}`);
            }
          } catch {
            cleanupFailures.push("organization verify: exception");
          }
        }
      } catch {
        cleanupFailures.push("organization lookup: exception");
      }
    }

    for (const id of userIds) {
      try {
        const removed = await admin.auth.admin.deleteUser(id);
        if (removed.error) cleanupFailures.push(`auth user delete: ${removed.error.message || "error"}`);
      } catch {
        cleanupFailures.push("auth user delete: exception");
      }
    }

    if (cleanupFailures.length === 0) {
      console.log(`CLEANUP OK run ${runId}`);
    } else {
      cleanupFailed = true;
      const kinds = [...new Set(cleanupFailures)].join(", ");
      console.error(
        `CLEANUP FAIL run ${runId} kinds=${kinds} — manual cleanup may be needed for this run id`,
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
