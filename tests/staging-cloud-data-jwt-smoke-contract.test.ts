/**
 * Static contract for the opt-in Staging cloud-data JWT smoke runner.
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
const runner = readRepo("scripts/staging-cloud-data-jwt-smoke.mjs");
const workflow = readRepo(".github/workflows/staging-cloud-data-jwt-smoke.yml");
const ci = readRepo(".github/workflows/ci.yml");
const executable = runner
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

describe("staging cloud data JWT smoke runner contract", () => {
  it("is an opt-in package script and is not invoked by CI", () => {
    assert.equal(pkg.scripts["test:staging-cloud-data"], "node scripts/staging-cloud-data-jwt-smoke.mjs");
    assert.equal(pkg.scripts.test.includes("staging-cloud-data"), false);
    assert.equal(ci.includes("staging-cloud-data-jwt-smoke"), false);
    assert.equal(ci.includes("test:staging-cloud-data"), false);
    assert.equal(ci.includes("STAGING_SUPABASE"), false);
  });

  it("hard-pins the Staging origin and requires the explicit confirmation", () => {
    assert.match(runner, /https:\/\/dezonafotwyvvghbccko\.supabase\.co/);
    assert.match(runner, /STAGING_SECURITY_TEST_CONFIRM/);
    assert.match(runner, /dezonafotwyvvghbccko/);
    assert.match(runner, /gguvmewknanhzukugvpj/);
    assert.match(runner, /parsed\.origin !== STAGING_ORIGIN/);
  });

  it("asserts access control with the anon key and a verified user session", () => {
    assert.match(runner, /STAGING_SUPABASE_ANON_KEY/);
    assert.match(runner, /verifyOtp\(\{ type: "magiclink", token_hash: hashed \}\)/);
    assert.match(runner, /getUser\(\)/);
    assert.match(runner, /function anonClient/);
  });

  it("limits the service role to disposable setup and cleanup", () => {
    assert.match(runner, /auth\.admin\.createUser/);
    assert.match(runner, /auth\.admin\.generateLink/);
    assert.match(runner, /auth\.admin\.deleteUser/);
    assert.match(runner, /from\("organizations"\)\.delete\(\)/);
    // Service role must not be used for business-table RLS assertions
    assert.doesNotMatch(
      executable,
      /from\("(properties|clients|needs|follow_ups|activities)"\)\.select[\s\S]{0,120}serviceKey/,
    );
  });

  it("covers the five Migration 009 business tables", () => {
    for (const table of ["properties", "clients", "needs", "follow_ups", "activities"]) {
      assert.match(runner, new RegExp(`from\\("${table}"\\)`));
    }
  });

  it("does not print secrets, sessions, or tokens", () => {
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*token/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*serviceKey/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*anonKey/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*hashed/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*emails/i);
  });

  it("does not insert into auth.users directly or apply migrations", () => {
    assert.doesNotMatch(executable, /insert into\s+auth\.users/i);
    assert.doesNotMatch(executable, /supabase\s+db\s+push/i);
    assert.doesNotMatch(executable, /migration/i);
  });

  it("refuses identical anon and service-role keys and service_role in the anon slot", () => {
    assert.match(runner, /anonKey === serviceKey/);
    assert.match(runner, /must be different/);
    assert.match(runner, /function jwtRoleClaim/);
    assert.match(runner, /STAGING_SUPABASE_ANON_KEY must not carry the service_role claim/);
  });

  it("attempts independent cleanup of each disposable auth user", () => {
    assert.match(runner, /cleanupFailures/);
    assert.match(runner, /kinds=\$\{kinds\}/);
    const orgBlock = runner.indexOf("organization lookup");
    const userLoop = runner.indexOf("for (const id of userIds)");
    assert.ok(orgBlock > 0 && userLoop > orgBlock, "user cleanup must follow org cleanup and run independently");
  });

  it("workflow is workflow_dispatch only and pinned to the cloud-data branch", () => {
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /\bpush:\b/);
    assert.doesNotMatch(workflow, /\bpull_request:\b/);
    assert.match(workflow, /feat\/etehad-cloud-data-foundation-20261112/);
    assert.match(workflow, /confirm_staging_run/);
    assert.match(workflow, /etehad-staging-security/);
    assert.match(workflow, /node-version: "22"/);
    assert.match(workflow, /dezonafotwyvvghbccko/);
  });
});
