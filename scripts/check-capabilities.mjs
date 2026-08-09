import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const capabilityUrl = new URL("../src-tauri/capabilities/default.json", import.meta.url);
const capability = JSON.parse(await readFile(capabilityUrl, "utf8"));
const requiredPermissions = ["sql:default", "sql:allow-execute"];
const missingPermissions = requiredPermissions.filter((permission) => !capability.permissions?.includes(permission));

if (missingPermissions.length > 0) {
  throw new Error(`Missing desktop capabilities: ${missingPermissions.join(", ")}`);
}

console.log(`capability-check: PASS (${requiredPermissions.join(", ")})`);
