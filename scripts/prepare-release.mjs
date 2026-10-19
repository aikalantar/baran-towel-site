import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readLocalSecrets } from "./local-secrets.mjs";
import { writeAuditReport } from "./audit-redact.mjs";

const exec = promisify(execFile), root = process.cwd();
// The reviewed manifest is input. Preparing a candidate must never replace it
// with a hard-coded file list from a previous release.
const manifest=JSON.parse(await fs.readFile("release-candidate.json","utf8"));
const {branch,files,baseline}=manifest;
if(manifest.schemaVersion!==2 || !/^codex\/[a-z0-9-]+$/.test(branch || "") || !/^[a-f0-9]{40}$/.test(baseline || "") ||
   !Array.isArray(files) || !files.length || new Set(files).size!==files.length ||
   !files.includes("release-candidate.json") || files.some(file=>typeof file!=="string" || !/^[a-zA-Z0-9_./-]+$/.test(file) || file.split('/').some(part=>!part || part==='.' || part==='..'))) throw new Error("Invalid reviewed release manifest.");
await exec("git",["merge-base","--is-ancestor",baseline,"HEAD"]);
const current = (await exec("git",["branch","--show-current"])).stdout.trim();
if (current !== branch) throw new Error("Switch to the preserved release branch before preparing the candidate.");
const {values} = await readLocalSecrets();
for (const file of files) {
  if (!path.resolve(file).startsWith(root+path.sep) || /(?:^|\/)(?:\.cms-local|\.dev\.vars|\.env|\.wrangler|screenshots|test-results)(?:\/|$|\.)|\.log$/i.test(file)) throw new Error("Unsafe candidate path.");
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Candidate files must be regular workspace files.");
  const content = await fs.readFile(file,"utf8");
  if (values.some(secret=>secret.length>=8 && content.includes(secret))) throw new Error("Actual local credential detected in candidate; staging refused.");
}
const previousStaged = (await exec("git",["diff","--cached","--name-only"])).stdout.trim().split(/\r?\n/).filter(Boolean);
if (previousStaged.some(file=>!files.includes(file))) throw new Error("Unrelated staged files were preserved. Review them separately before preparing this candidate.");
const protectedPaths = ["public/index.html","public/en/index.html","public/catalog/index.html","public/en/catalog/index.html","public/bridal-towels/index.html","public/blog/index.html","public/en/blog/index.html","public/blog/rahnamaye-kharid-hole-luxury/index.html","public/en/blog/how-to-choose-luxury-towels/index.html","public/styles.600f8d5159.css","public/script.df5cebe557.js","public/sitemap.xml","src/auth.js","src/content.js"];
if ((await exec("git",["diff",baseline,"--name-only","--",...protectedPaths])).stdout.trim()) throw new Error("A protected page or existing CMS/auth file changed; explicit review is required.");
const stage = process.argv.includes("--stage");
if (stage) await exec("git",["add","--",...files],{maxBuffer:2*1024*1024});
const report = {branch,fileCount:files.length,files,staged:stage,secretsExcluded:true,mainPublicFilesUnchanged:true,push:false,deploy:false};
await fs.mkdir(".cms-local/preflight",{recursive:true});
await writeAuditReport(".cms-local/preflight/release-stage.json",report);
console.log(JSON.stringify({branch,fileCount:files.length,staged:stage,secretsExcluded:true,push:false,deploy:false}));
