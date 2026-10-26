/**
 * Static contract for the opt-in Staging security runner.
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
const runner = readRepo("scripts/staging-security-smoke.mjs");
const ci = readRepo(".github/workflows/ci.yml");
const executable = runner
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

describe("staging security smoke runner contract", () => {
  it("is an opt-in package script and is not invoked by CI", () => {
    assert.equal(pkg.scripts["test:staging-security"], "node scripts/staging-security-smoke.mjs");
    assert.equal(pkg.scripts.test.includes("staging-security-smoke"), false);
    assert.equal(ci.includes("staging-security-smoke"), false);
    assert.equal(ci.includes("test:staging-security"), false);
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
    assert.doesNotMatch(executable, /from\("organization_invitations"\)\.select[\s\S]{0,80}serviceKey/);
  });

  it("does not print secrets, sessions, or invitation tokens", () => {
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*token/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*serviceKey/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*anonKey/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*hashed/i);
    assert.doesNotMatch(executable, /console\.(log|error|info|debug)\([^)]*emails/i);
  });

  it("does not insert into auth.users or apply migrations", () => {
    assert.doesNotMatch(executable, /insert into\s+auth\.users/i);
    assert.doesNotMatch(executable, /supabase\s+db\s+push/i);
    assert.doesNotMatch(executable, /migration/i);
  });
});
