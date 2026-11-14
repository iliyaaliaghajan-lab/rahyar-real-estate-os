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
    refusal("Refusing to run: STAGING_SUPABASE_ANON_KEY and STAGING_SUPABASE_SERVICE_ROLE_KEY must be different.");
  }
  const anonRole = jwtRoleClaim(anonKey);
  if (anonRole === "service_role") {
    refusal("Refusing to run: STAGING_SUPABASE_ANON_KEY must not carry the service_role claim.");
  }
  return { url: STAGING_ORIGIN, anonKey, serviceKey };
}

/** DELETE via user JWT; returns { count, error, kind }. Never uses service role. */
async function jwtDelete(client, table, id) {
  const res = await client.from(table).delete().eq("id", id).select("id");
  const count = Array.isArray(res.data) ? res.data.length : 0;
  return {
    count,
    error: res.error || null,
    kind: denialKind(res.error),
  };
}

/** SELECT count via user JWT. */
async function jwtExists(client, table, id) {
  const res = await client.from(table).select("id").eq("id", id).maybeSingle();
  if (res.error) return { exists: false, error: res.error };
  return { exists: !!res.data?.id, error: null };
}

async function main() {
  const { url, anonKey, serviceKey } = loadConfig();
  const runId = randomBytes(6).toString("hex");
  console.log(`staging-role-based-delete-jwt-smoke run ${runId} target=pinned-staging`);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const orgNameA = `rd-${runId}-org-a`;
  const orgNameB = `rd-${runId}-org-b`;
  const orgNames = new Set([orgNameA, orgNameB]);

  const emails = {
    ownerA: `rd-${runId}-owner-a@etehad-staging.test`,
    ownerB: `rd-${runId}-owner-b@etehad-staging.test`,
    adminA: `rd-${runId}-admin-a@etehad-staging.test`,
    agentA: `rd-${runId}-agent-a@etehad-staging.test`,
  };

  const userIds = [];
  /** @type {Record<string, import('@supabase/supabase-js').SupabaseClient>} */
  const sessions = {};
  let orgAId = null;
  let orgBId = null;
  let setupError = null;
  let cleanupFailed = false;

  const seed = {
    agent: { client: null, prop: null, need: null, fu: null },
    owner: { client: null, prop: null, need: null, fu: null },
    orgB: { client: null, prop: null, need: null, fu: null },
    activities: { owner: null, admin: null, agent: null },
  };

  try {
    const idOwnerA = await createDisposable(admin, emails.ownerA, runId, "ownerA");
    const idOwnerB = await createDisposable(admin, emails.ownerB, runId, "ownerB");
    const idAdminA = await createDisposable(admin, emails.adminA, runId, "adminA");
    const idAgentA = await createDisposable(admin, emails.agentA, runId, "agentA");
    userIds.push(idOwnerA, idOwnerB, idAdminA, idAgentA);

    sessions.ownerA = await sessionFor(url, anonKey, admin, emails.ownerA, idOwnerA);
    sessions.ownerB = await sessionFor(url, anonKey, admin, emails.ownerB, idOwnerB);
    sessions.adminA = await sessionFor(url, anonKey, admin, emails.adminA, idAdminA);
    sessions.agentA = await sessionFor(url, anonKey, admin, emails.agentA, idAgentA);
    record("SETUP-SESSION", "PASS", "four disposable sessions verified via getUser()");

    const createdA = await sessions.ownerA.rpc("create_organization_with_owner", { p_name: orgNameA });
    const rowA = Array.isArray(createdA.data) ? createdA.data[0] : createdA.data;
    if (createdA.error || !rowA?.organization_id) {
      throw new Error("owner A organization create failed");
    }
    orgAId = rowA.organization_id;

    const createdB = await sessions.ownerB.rpc("create_organization_with_owner", { p_name: orgNameB });
    const rowB = Array.isArray(createdB.data) ? createdB.data[0] : createdB.data;
    if (createdB.error || !rowB?.organization_id) {
      throw new Error("owner B organization create failed");
    }
    orgBId = rowB.organization_id;
    record("SETUP-ORG", "PASS", "two independent orgs created via create_organization_with_owner");

    const memAdmin = await admin.from("organization_members").insert({
      organization_id: orgAId,
      user_id: idAdminA,
      role: "admin",
      status: "active",
      joined_at: new Date().toISOString(),
    }).select("id, role, status").single();
    if (memAdmin.error || memAdmin.data?.role !== "admin") {
      throw new Error("admin membership provision failed");
    }

    const memAgent = await admin.from("organization_members").insert({
      organization_id: orgAId,
      user_id: idAgentA,
      role: "agent",
      status: "active",
      joined_at: new Date().toISOString(),
    }).select("id, role, status").single();
    if (memAgent.error || memAgent.data?.role !== "agent") {
      throw new Error("agent membership provision failed");
    }

    for (const [label, client, expected exRole, expectedOrg] of [
      ["ownerA", sessions.ownerA, "owner", orgAId],
      ["ownerB", sessions.ownerB, "owner", orgBId],
      ["adminA", sessions.adminA, "admin", orgAId],
      ["agentA", sessions.agentA, "agent", orgAId],
    ]) {
      const m = await client
        .from("organization_members")
        .select("organization_id, role, status")
        .eq("status", "active")
        .maybeSingle();
      if (m.error || !m.data) {
        throw new Error(`membership read-back failed for ${label}`);
      }
      if (m.data.role !== expectedRole || m.data.organization_id !== expectedOrg) {
        throw new Error(`membership role/org mismatch for ${label}`);
      }
      const all = await client.from("organization_members").select("id").eq("status", "active");
      if (all.error || (all.data || []).length !== 1) {
        throw new Error(`phase-1 membership count invalid for ${label}`);
      }
    }
    record("SETUP-MEMBERSHIP", "PASS", "roles read back from organization_members (not user_metadata)");

    {
      const c = await sessions.agentA.from("clients").insert({
        organization_id: orgAId,
        name: `Agent Client ${runId}`,
        created_by: idAgentA,
        updated_by: idAgentA,
      }).select("id").single();
      if (c.error || !c.data?.id) throw new Error("agent client seed failed");
      seed.agent.client = c.data.id;

      const p = await sessions.agentA.from("properties").insert({
        organization_id: orgAId,
        title: `Agent Prop ${runId}`,
        created_by: idAgentA,
        updated_by: idAgentA,
      }).select("id").single();
      if (p.error || !p.data?.id) throw new Error("agent property seed failed");
      seed.agent.prop = p.data.id;

      const n = await sessions.agentA.from("needs").insert({
        organization_id: orgAId,
        client_id: seed.agent.client,
        created_by: idAgentA,
        updated_by: idAgentA,
      }).select("id").single();
      if (n.error || !n.data?.id) throw new Error("agent need seed failed");
      seed.agent.need = n.data.id;

      const f = await sessions.agentA.from("follow_ups").insert({
        organization_id: orgAId,
        client_id: seed.agent.client,
        property_id: seed.agent.prop,
        title: `Agent FU ${runId}`,
        created_by: idAgentA,
        updated_by: idAgentA,
      }).select("id").single();
      if (f.error || !f.data?.id) throw new Error("agent follow_up seed failed");
      seed.agent.fu = f.data.id;
    }

    {
      const c = await sessions.ownerA.from("clients").insert({
        organization_id: orgAId,
        name: `Owner Client ${runId}`,
        created_by: idOwnerA,
        updated_by: idOwnerA,
      }).select("id").single();
      if (c.error || !c.data?.id) throw new Error("owner client seed failed");
      seed.owner.client = c.data.id;

      const p = await sessions.ownerA.from("properties").insert({
        organization_id: orgAId,
        title: `Owner Prop ${runId}`,
        created_by: idOwnerA,
        updated_by: idOwnerA,
      }).select("id").single();
      if (p.error || !p.data?.id) throw new Error("owner property seed failed");
      seed.owner.prop = p.data.id;

      const n = await sessions.ownerA.from("needs").insert({
        organization_id: orgAId,
        client_id: seed.owner.client,
        created_by: idOwnerA,
        updated_by: idOwnerA,
      }).select("id").single();
      if (n.error || !n.data?.id) throw new Error("owner need seed failed");
      seed.owner.need = n.data.id;

      const f = await sessions.ownerA.from("follow_ups").insert({
        organization_id: orgAId,
        client_id: seed.owner.client,
        property_id: seed.owner.prop,
        title: `Owner FU ${runId}`,
        created_by: idOwnerA,
        updated_by: idOwnerA,
      }).select("id").single();
      if (f.error || !f.data?.id) throw new Error("owner follow_up seed failed");
      seed.owner.fu = f.data.id;
    }

    {
      const c = await sessions.ownerB.from("clients").insert({
        organization_id: orgBId,
        name: `OrgB Client ${runId}`,
        created_by: idOwnerB,
        updated_by: idOwnerB,
      }).select("id").single();
      if (c.error || !c.data?.id) throw new Error("orgB client seed failed");
      seed.orgB.client = c.data.id;

      const p = await sessions.ownerB.from("properties").insert({
        organization_id: orgBId,
        title: `OrgB Prop ${runId}`,
        created_by: idOwnerB,
        updated_by: idOwnerB,
      }).select("id").single();
      if (p.error || !p.data?.id) throw new Error("orgB property seed failed");
      seed.orgB.prop = p.data.id;

      const n = await sessions.ownerB.from("needs").insert({
        organization_id: orgBId,
        client_id: seed.orgB.client,
        created_by: idOwnerB,
        updated_by: idOwnerB,
      }).select("id").single();
      if (n.error || !n.data?.id) throw new Error("orgB need seed failed");
      seed.orgB.need = n.data.id;

      const f = await sessions.ownerB.from("follow_ups").insert({
        organization_id: orgBId,
        client_id: seed.orgB.client,
        property_id: seed.orgB.prop,
        title: `OrgB FU ${runId}`,
        created_by: idOwnerB,
        updated_by: idOwnerB,
      }).select("id").single();
      if (f.error || !f.data?.id) throw new Error("orgB follow_up seed failed");
      seed.orgB.fu = f.data.id;
    }
    record("SETUP-SEED", "PASS", "agent/owner/orgB business rows seeded via JWT");

    for (const [setLabel, set] of [
      ["agent-own", seed.agent],
      ["owner-created", seed.owner],
    ]) {
      for (const [table, id] of [
        ["follow_ups", set.fu],
        ["needs", set.need],
        ["properties", set.prop],
        ["clients", set.client],
      ]) {
        const del = await jwtDelete(sessions.agentA, table, id);
        const blocked =
          (del.count === 0 && (!del.error || del.kind === "permission" || del.kind === "none")) ||
          del.kind === "permission";
        if (!blocked || del.kind === "auth" || del.kind === "fk" || del.kind === "other") {
          record(
            `R-AGENT-DENY-${setLabel}-${table}`,
            "FAIL",
            `unexpected delete outcome count=${del.count} kind=${del.kind}`,
          );
          continue;
        }
        const check = await jwtExists(sessions.ownerA, table, id);
        if (!check.exists) {
          record(`R-AGENT-DENY-${setLabel}-${table}`, "FAIL", "row missing after agent DELETE attempt");
        } else {
          record(`R-AGENT-DENY-${setLabel}-${table}`, "PASS", `agent delete blocked (count=${del.count} kind=${del.kind})`);
        }
      }
    }

    for (const [table, id] of [
      ["follow_ups", seed.agent.fu],
      ["needs", seed.agent.need],
      ["properties", seed.agent.prop],
      ["clients", seed.agent.client],
    ]) {
      const del = await jwtDelete(sessions.adminA, table, id);
      if (del.count !== 1 || del.error) {
        record(`R-ADMIN-DEL-${table}`, "FAIL", `expected 1 deleted, got count=${del.count} kind=${del.kind}`);
        continue;
      }
      const check = await jwtExists(sessions.ownerA, table, id);
      if (check.exists) {
        record(`R-ADMIN-DEL-${table}`, "FAIL", "row still present after admin DELETE");
      } else {
        record(`R-ADMIN-DEL-${table}`, "PASS", "admin deleted agent-created row");
        if (table === "follow_ups") seed.agent.fu = null;
        if (table === "needs") seed.agent.need = null;
        if (table === "properties") seed.agent.prop = null;
        if (table === "clients") seed.agent.client = null;
      }
    }

    for (const [table, id] of [
      ["follow_ups", seed.owner.fu],
      ["needs", seed.owner.need],
      ["properties", seed.owner.prop],
      ["clients", seed.owner.client],
    ]) {
      const del = await jwtDelete(sessions.ownerA, table, id);
      if (del.count !== 1 || del.error) {
        record(`R-OWNER-DEL-${table}`, "FAIL", `expected 1 deleted, got count=${del.count} kind=${del.kind}`);
        continue;
      }
      const check = await jwtExists(sessions.ownerA, table, id);
      if (check.exists) {
        record(`R-OWNER-DEL-${table}`, "FAIL", "row still present after owner DELETE");
      } else {
        record(`R-OWNER-DEL-${table}`, "PASS", "owner deleted own-org row");
        if (table === "follow_ups") seed.owner.fu = null;
        if (table === "needs") seed.owner.need = null;
        if (table === "properties") seed.owner.prop = null;
        if (table === "clients") seed.owner.client = null;
      }
    }

    {
      const del = await jwtDelete(sessions.adminA, "clients", seed.orgB.client);
      const blocked =
        (del.count === 0 && (!del.error || del.kind === "permission" || del.kind === "none")) ||
        del.kind === "permission";
      if (!blocked || del.kind === "auth" || del.kind === "fk" || del.kind === "other") {
        record("R-TENANT-ADMIN-ORGB", "FAIL", `unexpected outcome count=${del.count} kind=${del.kind}`);
      } else {
        const check = await jwtExists(sessions.ownerB, "clients", seed.orgB.client);
        if (!check.exists) {
          record("R-TENANT-ADMIN-ORGB", "FAIL", "OrgB client missing after Admin A DELETE attempt");
        } else {
          record("R-TENANT-ADMIN-ORGB", "PASS", "Admin A cannot delete OrgB client; Owner B still sees it");
        }
      }
    }

    // Contract markers (exact ids exercised in the loop below):
    // R-ACT-INSERT-owner R-ACT-INSERT-admin R-ACT-INSERT-agent
    // R-ACT-UPDATE-owner R-ACT-UPDATE-admin R-ACT-UPDATE-agent
    // R-ACT-DELETE-owner R-ACT-DELETE-admin R-ACT-DELETE-agent
    // R-ACT-READBACK-owner R-ACT-READBACK-admin R-ACT-READBACK-agent
    for (const [label, client, uid] of [
      ["owner", sessions.ownerA, idOwnerA],
      ["admin", sessions.adminA, idAdminA],
      ["agent", sessions.agentA, idAgentA],
    ]) {
      const ins = await client.from("activities").insert({
        organization_id: orgAId,
        type: "client",
        text: `activity-${label}-${runId}`,
        created_by: uid,
      }).select("id, text").single();
      if (ins.error || !ins.data?.id) {
        record(`R-ACT-INSERT-${label}`, "FAIL", "activity INSERT failed");
        continue;
      }
      record(`R-ACT-INSERT-${label}`, "PASS", "activity INSERT succeeded");
      seed.activities[label] = ins.data.id;
      const actId = ins.data.id;
      const originalText = ins.data.text;

      const upd = await client.from("activities").update({ text: "mutated" }).eq("id", actId).select("id");
      const updCount = Array.isArray(upd.data) ? upd.data.length : 0;
      const updBlocked =
        (updCount === 0 && (!upd.error || denialKind(upd.error) === "permission" || denialKind(upd.error) === "none")) ||
        denialKind(upd.error) === "permission";
      if (!updBlocked || denialKind(upd.error) === "auth") {
        record(`R-ACT-UPDATE-${label}`, "FAIL", `unexpected UPDATE outcome kind=${denialKind(upd.error)}`);
      } else {
        record(`R-ACT-UPDATE-${label}`, "PASS", "activity UPDATE blocked");
      }

      const del = await jwtDelete(client, "activities", actId);
      const delBlocked =
        (del.count === 0 && (!del.error || del.kind === "permission" || del.kind === "none")) ||
        del.kind === "permission";
      if (!delBlocked || del.kind === "auth") {
        record(`R-ACT-DELETE-${label}`, "FAIL", `unexpected DELETE outcome kind=${del.kind}`);
      } else {
        record(`R-ACT-DELETE-${label}`, "PASS", "activity DELETE blocked");
      }

      const rb = await client.from("activities").select("id, text").eq("id", actId).maybeSingle();
      if (rb.error || !rb.data?.id || rb.data.text !== originalText) {
        record(`R-ACT-READBACK-${label}`, "FAIL", "activity row changed or missing after denied mutations");
      } else {
        record(`R-ACT-READBACK-${label}`, "PASS", "activity row unchanged");
      }
    }
  } catch (err) {
    setupError = err instanceof Error ? err.message : "setup failed";
    console.error(`SETUP ERROR run ${runId}: ${setupError}`);
  } finally {
    const cleanupFailures = [];

    if (sessions.ownerA) {
      await trackedDelete(sessions.ownerA, "follow_ups", seed.owner.fu, cleanupFailures, "owner-fu");
      await trackedDelete(sessions.ownerA, "needs", seed.owner.need, cleanupFailures, "owner-need");
      await trackedDelete(sessions.ownerA, "properties", seed.owner.prop, cleanupFailures, "owner-prop");
      await trackedDelete(sessions.ownerA, "clients", seed.owner.client, cleanupFailures, "owner-client");
      await trackedDelete(sessions.ownerA, "follow_ups", seed.agent.fu, cleanupFailures, "agent-fu");
      await trackedDelete(sessions.ownerA, "needs", seed.agent.need, cleanupFailures, "agent-need");
      await trackedDelete(sessions.ownerA, "properties", seed.agent.prop, cleanupFailures, "agent-prop");
      await trackedDelete(sessions.ownerA, "clients", seed.agent.client, cleanupFailures, "agent-client");
    }
    if (sessions.ownerB) {
      await trackedDelete(sessions.ownerB, "follow_ups", seed.orgB.fu, cleanupFailures, "orgb-fu");
      await trackedDelete(sessions.ownerB, "needs", seed.orgB.need, cleanupFailures, "orgb-need");
      await trackedDelete(sessions.ownerB, "properties", seed.orgB.prop, cleanupFailures, "orgb-prop");
      await trackedDelete(sessions.ownerB, "clients", seed.orgB.client, cleanupFailures, "orgb-client");
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
