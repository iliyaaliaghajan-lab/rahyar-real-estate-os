/**
 * Static contract for the opt-in Staging role-based DELETE JWT smoke runner.
 * Does not contact Supabase and does not prove live RLS.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readRepo(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

const pkg = JSON.parse(readRepo("package.json")) as { scripts: Record<string, string> };
const runner = readRepo("scripts/staging-role-based-delete-jwt-smoke.mjs");
const workflow = readRepo(".github/workflows/staging-role-based-delete-jwt-smoke.yml");
const ci = readRepo(".github/workflows/ci.yml");
const executable = runner
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

describe("staging role-based DELETE JWT smoke runner contract", () => {
  it("is an opt-in package script and is not invoked by CI", () => {
    assert.equal(pkg.scripts["test:staging-role-delete"], "node scripts/staging-role-based-delete-jwt-smoke.mjs");
    assert.equal(pkg.scripts.test.includes("staging-role-delete"), false);
    assert.equal(pkg.scripts.test.includes("staging-role-based-delete"), false);
    assert.equal(ci.includes("staging-role-based-delete-jwt-smoke"), false);
    assert.equal(ci.includes("test:staging-role-delete"), false);
    assert.equal(ci.includes("STAGING_MIGRATION_011"), false);
  });

  it("hard-pins the Staging origin and refuses Production", () => {
    assert.match(runner, /https:\/\/dezonafotwyvvghbccko\.supabase\.co/);
    assert.match(runner, /STAGING_SECURITY_TEST_CONFIRM/);
    assert.match(runner, /dezonafotwyvvghbccko/);
    assert.match(runner, /gguvmewknanhzukugvpj/);
    assert.match(runner, /parsed\.origin !== STAGING_ORIGIN/);
  });

  it("requires explicit Migration 011 confirmation before any mutating work", () => {
    assert.match(runner, /STAGING_MIGRATION_011_CONFIRMED/);
    assert.match(runner, /migration011 !== "true"/);
    assert.match(runner, /never applies migrations/i);
  });

  it("asserts access control with the anon key and a verified user session", () => {
    assert.match(runner, /STAGING_SUPABASE_ANON_KEY/);
    assert.match(runner, /sessionFor/);
    assert.match(runner, /getUser/);
    assert.match(runner, /staging-cloud-data-jwt-smoke-lib\.mjs/);
    const lib = readRepo("scripts/staging-cloud-data-jwt-smoke-lib.mjs");
    assert.match(lib, /verifyOtp\(\{ type: "magiclink", token_hash: hashed \}\)/);
    assert.match(lib, /getUser\(\)/);
  });

  it("limits the service role to disposable setup, membership provision, and cleanup", () => {
    assert.match(runner, /createDisposable/);
    assert.match(runner, /auth\.admin\.deleteUser/);
    assert.match(runner, /from\("organizations"\)\.delete\(\)/);
    assert.match(runner, /from\("organization_members"\)\.insert/);
    // Service role must not be used for business-table DELETE authorization assertions
    assert.doesNotMatch(
      executable,
      /from\("(properties|clients|needs|follow_ups|activities)"\)\.delete[\s\S]{0,80}admin\b/,
    );
    assert.match(runner, /jwtDelete/);
  });

  it("covers four business tables in the agent/owner/admin matrix and activities", () => {
    for (const table of ["properties", "clients", "needs", "follow_ups", "activities"]) {
      assert.match(runner, new RegExp(`from\\("${table}"\\)`));
    }
    assert.match(runner, /R-AGENT-DENY/);
    assert.match(runner, /R-ADMIN-DEL/);
    assert.match(runner, /R-OWNER-DEL/);
    assert.match(runner, /R-TENANT-ADMIN-ORGB/);
    assert.match(runner, /R-ACT-INSERT/);
    assert.match(runner, /R-ACT-UPDATE/);
    assert.match(runner, /R-ACT-DELETE/);
  });

  it("keeps activities append-only for owner, admin, and agent", () => {
    assert.match(runner, /R-ACT-UPDATE-owner/);
    assert.match(runner, /R-ACT-UPDATE-admin/);
    assert.match(runner, /R-ACT-UPDATE-agent/);
    assert.match(runner, /R-ACT-DELETE-owner/);
    assert.match(runner, /R-ACT-DELETE-admin/);
    assert.match(runner, /R-ACT-DELETE-agent/);
  });

  it("does not print secrets, sessions, or tokens", () => {
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*token/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*serviceKey/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*anonKey/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*hashed/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*emails/i);
  });

  it("does not apply migrations or use supabase db push", () => {
    // Allow documentation comments; forbid executable apply commands
    assert.doesNotMatch(executable, /\bnpm\s+run\s+.*db\s+push\b/i);
    assert.doesNotMatch(executable, /\bexecSync\([^)]*db\s+push/i);
    assert.doesNotMatch(executable, /insert into\s+auth\.users/i);
    assert.match(runner, /never applies migrations/i);
    assert.match(runner, /STAGING_MIGRATION_011_CONFIRMED/);
  });

  it("attempts independent cleanup of disposable orgs and auth users", () => {
    assert.match(runner, /cleanupFailures/);
    assert.match(runner, /kinds=\$\{kinds\}/);
    assert.match(runner, /CLEANUP OK/);
    assert.match(runner, /CLEANUP FAIL/);
    const orgBlock = runner.indexOf("organization lookup");
    const userLoop = runner.indexOf("for (const id of userIds)");
    assert.ok(orgBlock > 0 && userLoop > orgBlock, "user cleanup must follow org cleanup");
  });

  it("workflow is workflow_dispatch only with dual confirms and branch pin", () => {
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^[ \t]*push[ \t]*:/m);
    assert.doesNotMatch(workflow, /^[ \t]*pull_request[ \t]*:/m);
    assert.match(workflow, /feat\/etehad-role-based-business-delete-20261114/);
    assert.match(workflow, /confirm_staging_run/);
    assert.match(workflow, /confirm_migration_011_already_applied/);
    assert.match(workflow, /etehad-staging-security/);
    assert.match(workflow, /node-version: "22"/);
    assert.match(workflow, /dezonafotwyvvghbccko/);
    assert.match(workflow, /STAGING_MIGRATION_011_CONFIRMED/);
    // Comments may mention the forbidden command; executable steps must not run it
    assert.doesNotMatch(workflow, /^\s*run:\s*.*supabase\s+db\s+push/m);
    assert.doesNotMatch(workflow, /^\s*run:\s*.*db\s+push/m);
    assert.match(workflow, /never applies migrations/i);
  });
});
