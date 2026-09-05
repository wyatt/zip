import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cli = "node_modules/convex/bin/main.js";
const existing = spawnSync(process.execPath, [cli, "env", "get", "JWKS"], { encoding: "utf8" });
if (existing.status !== 0) throw new Error("Start the Convex backend before configuring authentication.");
if (existing.stdout.trim()) {
  console.log("Authentication keys already configured; preserved existing sessions.");
  process.exit(0);
}
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), use: "sig", alg: "RS256" }] });
const dir = mkdtempSync(join(tmpdir(), "zip-auth-"));
const file = join(dir, "auth.env");
try {
  writeFileSync(file, `JWT_PRIVATE_KEY="${privatePem}"\nJWKS=${jwks}\n`, { mode: 0o600 });
  const result = spawnSync(process.execPath, [cli, "env", "set", "--from-file", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Could not configure authentication keys. Check the local Convex deployment.");
  console.log("Authentication signing keys configured. No secrets written to the repository.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
