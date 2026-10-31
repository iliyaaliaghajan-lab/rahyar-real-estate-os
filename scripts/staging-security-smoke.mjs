/**
 * Opt-in Staging security smoke runner.
 * Not part of CI. Refuses to run unless pinned to the Staging project.
 * Service role is used only to provision and delete disposable users/orgs.
 * Access-control assertions use the anon key plus a real user session.
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
      purpose: "staging-security-smoke",
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
  console.log(`staging-security-smoke run ${runId} target=pinned-staging`);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userIds = [];
  const orgNames = new Set();
  const orgNameA = `sec-${runId}-org-a`;
  const orgNameB = `sec-${runId}-org-b`;
  orgNames.add(orgNameA);
  orgNames.add(orgNameB);

  const emails = {
    A: `sec-${runId}-a@etehad-staging.test`,
    D: `sec-${runId}-d@etehad-staging.test`,
    C: `sec-${runId}-c@etehad-staging.test`,
    B: `sec-${runId}-b@etehad-staging.test`,
  };

  let clients = {};
  let orgAId = null;
  let orgBId = null;
  let tokenC = null;
  let tokenB = null;
  let setupError = null;
  let cleanupFailed = false;

  try {
    try {
      for (const label of ["A", "D", "C", "B"]) {
        const id = await createDisposable(admin, emails[label], runId, label);
        userIds.push(id);
      }
      clients.A = await sessionFor(url, anonKey, admin, emails.A, userIds[0]);
      clients.D = await sessionFor(url, anonKey, admin, emails.D, userIds[1]);
      clients.C = await sessionFor(url, anonKey, admin, emails.C, userIds[2]);
      clients.B = await sessionFor(url, anonKey, admin, emails.B, userIds[3]);

      const createdA = await clients.A.rpc("create_organization_with_owner", { p_name: orgNameA });
      const rowA = Array.isArray(createdA.data) ? createdA.data[0] : createdA.data;
      if (createdA.error || !rowA?.organization_id) {
        throw new Error("owner A organization create failed");
      }
      orgAId = rowA.organization_id;

      const createdD = await clients.D.rpc("create_organization_with_owner", { p_name: orgNameB });
      const rowD = Array.isArray(createdD.data) ? createdD.data[0] : createdD.data;
      if (createdD.error || !rowD?.organization_id) {
        throw new Error("owner D organization create failed");
      }
      orgBId = rowD.organization_id;
    } catch (err) {
      setupError = err instanceof Error ? err.message : "setup failed";
      console.error(`SETUP FAIL — ${setupError}`);
    }

    const skip = (id, why) => record(id, "SKIP", why);

    if (setupError) {
      for (const id of [
        "L1-owner",
        "S5",
        "L2-C",
        "L5a",
        "L4-C",
        "L3",
        "L1-agent",
        "L2-B",
        "L4-B",
        "L5b",
        "L6",
        "S6",
      ]) {
        skip(id, "setup failed");
      }
    } else {
      const readInvites = async (client, id) => {
        const res = await client.from("organization_invitations").select("id,email,token_hash");
        const kind = denialKind(res.error);
        if (kind === "permission") record(id, "PASS", "direct select explicitly denied");
        else if (!res.error) record(id, "FAIL", "select returned without a permission error");
        else if (kind === "auth") record(id, "FAIL", "session or authentication error, not a table denial");
        else record(id, "FAIL", "select failed for a non-permission reason");
      };

      await readInvites(clients.A, "L1-owner");

      const rogueName = `sec-${runId}-rogue-org`;
      orgNames.add(rogueName);
      const insertOrg = await clients.A.from("organizations").insert({ name: rogueName }).select("id");
      const insertKind = denialKind(insertOrg.error);
      if (insertKind === "permission") record("S5", "PASS", "direct organization insert denied");
      else if (!insertOrg.error) record("S5", "FAIL", "direct organization insert succeeded");
      else if (insertKind === "auth") record("S5", "FAIL", "session error, not a write denial");
      else record("S5", "FAIL", "insert failed for a non-permission reason");

      const inviteC = await clients.A.rpc("create_organization_invitation", {
        p_email: emails.C,
        p_role: "agent",
      });
      const inviteCRow = Array.isArray(inviteC.data) ? inviteC.data[0] : inviteC.data;
      if (inviteC.error || !inviteCRow?.token) {
        record("L2-C", "FAIL", "owner could not create the agent invitation");
      } else {
        tokenC = inviteCRow.token;
        record("L2-C", "PASS", "owner created an agent invitation");
      }

      if (!tokenC) {
        skip("L5a", "no pending invitation");
        skip("L4-C", "no pending invitation");
      } else {
        const wrong = await clients.D.rpc("accept_organization_invitation", { p_token: tokenC });
        if (wrong.error && /email does not match/i.test(wrong.error.message || "")) {
          record("L5a", "PASS", "wrong email rejected");
        } else if (!wrong.error) {
          record("L5a", "FAIL", "wrong email was accepted");
        } else {
          record("L5a", "FAIL", "rejection was not the email-mismatch error");
        }

        const acceptC = await clients.C.rpc("accept_organization_invitation", { p_token: tokenC });
        const acceptRow = Array.isArray(acceptC.data) ? acceptC.data[0] : acceptC.data;
        if (acceptC.error || acceptRow?.organization_id !== orgAId || acceptRow?.member_role !== "agent") {
          record("L4-C", "FAIL", "agent acceptance did not return the expected organization and role");
        } else {
          const membership = await clients.C
            .from("organization_members")
            .select("organization_id,role,status")
            .eq("user_id", userIds[2]);
          const row = (membership.data || []).find(
            (item) => item.organization_id === orgAId && item.role === "agent" && item.status === "active",
          );
          if (membership.error || !row) record("L4-C", "FAIL", "active agent membership was not visible to the member");
          else record("L4-C", "PASS", "agent membership is active in the inviting organization");
        }
      }

      const agentJoined = results.find((item) => item.id === "L4-C" && item.status === "PASS");
      if (!agentJoined) {
        skip("L3", "agent membership was not established");
        skip("L1-agent", "agent membership was not established");
        skip("S6", "agent membership was not established");
      } else {
        const blocked = await clients.C.rpc("create_organization_invitation", {
          p_email: `sec-${runId}-nobody@etehad-staging.test`,
          p_role: "agent",
        });
        const message = blocked.error?.message || "";
        if (!blocked.error) record("L3", "FAIL", "agent created an invitation");
        else if (/jwt|not authenticated/i.test(message)) {
          record("L3", "FAIL", "invalid session, not an authorization failure");
        } else if (/not authorized/i.test(message)) record("L3", "PASS", "agent authorization rejected");
        else record("L3", "FAIL", "rejection was not an authorization failure");

        await readInvites(clients.C, "L1-agent");
      }

      const inviteB = await clients.A.rpc("create_organization_invitation", {
        p_email: emails.B,
        p_role: "agent",
      });
      const inviteBRow = Array.isArray(inviteB.data) ? inviteB.data[0] : inviteB.data;
      if (inviteB.error || !inviteBRow?.token) {
        record("L2-B", "FAIL", "owner could not create the invitee invitation");
        skip("L4-B", "no invitee invitation");
        skip("L5b", "no invitee invitation");
      } else {
        tokenB = inviteBRow.token;
        record("L2-B", "PASS", "owner created the invitee invitation");
        const acceptB = await clients.B.rpc("accept_organization_invitation", { p_token: tokenB });
        const acceptBRow = Array.isArray(acceptB.data) ? acceptB.data[0] : acceptB.data;
        if (acceptB.error || acceptBRow?.organization_id !== orgAId || acceptBRow?.member_role !== "agent") {
          record("L4-B", "FAIL", "invitee acceptance did not return the expected organization and role");
          skip("L5b", "invitee acceptance failed");
        } else {
          const membership = await clients.B
            .from("organization_members")
            .select("organization_id,role,status")
            .eq("user_id", userIds[3]);
          const row = (membership.data || []).find(
            (item) => item.organization_id === orgAId && item.role === "agent" && item.status === "active",
          );
          if (membership.error || !row) {
            record("L4-B", "FAIL", "active invitee membership was not visible");
            skip("L5b", "membership was not confirmed");
          } else {
            record("L4-B", "PASS", "invitee membership is active in the inviting organization");
            const replay = await clients.B.rpc("accept_organization_invitation", { p_token: tokenB });
            if (replay.error && /already accepted/i.test(replay.error.message || "")) {
              record("L5b", "PASS", "reused invitation rejected");
            } else if (!replay.error) {
              record("L5b", "FAIL", "reused invitation was accepted");
            } else {
              record("L5b", "FAIL", "replay rejection was not already-accepted");
            }
          }
        }
      }

      const orgs = await clients.A.from("organizations").select("id,name");
      const members = await clients.A.from("organization_members").select("organization_id,user_id,role");
      if (orgs.error || members.error) {
        record("L6", "FAIL", "authenticated isolation queries did not succeed");
      } else {
        const names = new Set((orgs.data || []).map((row) => row.name));
        const orgIds = new Set((orgs.data || []).map((row) => row.id));
        const memberOrgIds = new Set((members.data || []).map((row) => row.organization_id));
        const seesA = names.has(orgNameA) && orgIds.has(orgAId);
        const seesB = names.has(orgNameB) || orgIds.has(orgBId) || memberOrgIds.has(orgBId);
        const foreignMembers = (members.data || []).some((row) => row.organization_id !== orgAId);
        if (seesA && !seesB && !foreignMembers) record("L6", "PASS", "owner A sees only organization A");
        else record("L6", "FAIL", "cross-organization rows were visible or organization A was missing");
      }

      if (agentJoined) {
        const update = await clients.A
          .from("organization_members")
          .update({ role: "owner" })
          .eq("organization_id", orgAId)
          .eq("user_id", userIds[2])
          .select("id");
        const kind = denialKind(update.error);
        if (kind === "permission") record("S6", "PASS", "direct role update denied");
        else if (!update.error) record("S6", "FAIL", "direct role update was not denied");
        else if (kind === "auth") record("S6", "FAIL", "session error, not a write denial");
        else record("S6", "FAIL", "update failed for a non-permission reason");
      }
    }
  } finally {
    tokenC = null;
    tokenB = null;
    const cleanupFailures = [];
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
