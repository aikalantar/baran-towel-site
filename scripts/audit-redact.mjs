import fs from "node:fs/promises";
import { readLocalSecrets } from "./local-secrets.mjs";

const sensitiveKey = /(?:password|passwd|passphrase|token|secret|authorization|cookie|salt|(?:^|_)hash$|CMS_USERS|private.?key)/i;
export function redactText(value, sensitiveValues = []) {
  let result = String(value);
  for (const secret of [...sensitiveValues].sort((a,b)=>b.length-a.length)) {
    if (typeof secret !== "string" || secret.length < 3) continue;
    for (const form of new Set([secret,JSON.stringify(secret).slice(1,-1),encodeURIComponent(secret)])) result = result.split(form).join("[REDACTED]");
  }
  return result
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,"[REDACTED]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,"[REDACTED]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi,"[REDACTED]")
    .replace(/((?:["']?)(?:CMS_USERS|CMS_[A-Z_]*(?:TOKEN|SECRET)|password|passwd|salt|hash|token|secret|authorization|cookie)(?:["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,"$1[REDACTED]")
    .replace(/([?&](?:token|key|secret|password|auth)=)[^&#\s]+/gi,"$1[REDACTED]")
    .replace(/\b[a-f0-9]{32,}\b/gi,"[REDACTED]");
}
export function redactRecord(value, key = "", seen = new WeakSet(), sensitiveValues = []) {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value,sensitiveValues);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  const result = Array.isArray(value) ? value.map(item => redactRecord(item,"",seen,sensitiveValues)) : Object.fromEntries(Object.entries(value).map(([k,v]) => [k,redactRecord(v,k,seen,sensitiveValues)]));
  seen.delete(value); return result;
}
export async function writeAuditReport(filename, report) {
  const {values} = await readLocalSecrets();
  await fs.writeFile(filename, JSON.stringify(redactRecord(report,"",new WeakSet(),values),null,2) + "\n", {mode:0o600});
}
