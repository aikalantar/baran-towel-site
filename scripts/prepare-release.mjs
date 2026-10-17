import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readLocalSecrets } from "./local-secrets.mjs";
import { writeAuditReport } from "./audit-redact.mjs";

const exec = promisify(execFile), root = process.cwd(), branch = "codex/visual-builder-release";
const files = [
  "BUILDER-GUIDE-FA.md","RELEASE-PREFLIGHT-FA.md","release-candidate.json","package.json",
  "public/admin/admin.js","public/admin/builder/index.html","public/admin/builder/builder.css","public/admin/builder/builder.js","public/admin/builder/model.js","public/admin/builder/layout.js","public/admin/builder/images.js","public/admin/builder/image-format.js","public/builder-layout.js",
  "src/cms-worker.js","src/github.js","src/builder.js","src/builder-images.js",
  "scripts/cms-local.mjs","scripts/cms-setup.mjs","scripts/audit-redact.mjs","scripts/local-secrets.mjs","scripts/release-preflight.mjs","scripts/prepare-release.mjs",
  "test/cms-setup.test.mjs","test/builder.test.mjs","test/builder-browser.mjs","test/builder-publish.test.mjs","test/builder-publish-browser.mjs","test/github-simulation.mjs","test/browser-smoke.mjs","test/site-audit.mjs","test/release-security.test.mjs","test/release-runtime.mjs","test/release-browser.mjs","test/fixtures/release-canary.json",
].sort();
const current = (await exec("git",["branch","--show-current"])).stdout.trim();
if (current !== branch) throw new Error("Switch to the preserved release branch before preparing the candidate.");
const manifest = {
  schemaVersion:1,branch,files,
  worker:"baran-towel-site",workerEntry:"src/cms-worker.js",staticAssets:"public",builderRoute:"/admin/builder/",publishingRepository:"aikalantar/baran-towel-site",publishingBranch:"main",
  tests:["npm test","npm run test:builder","npm run test:builder:publish","npm run test:browser","npm run test:release:browser","npm run test:release:runtime","node test/cms-runtime.mjs"],
  rollbackGuide:"RELEASE-PREFLIGHT-FA.md",canary:"test/fixtures/release-canary.json",onlineAuthorizationRequired:true,
};
await fs.writeFile("release-candidate.json",JSON.stringify(manifest,null,2)+"\n");
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
if ((await exec("git",["diff","HEAD","--name-only","--",...protectedPaths])).stdout.trim()) throw new Error("A protected page or existing CMS/auth file changed; explicit review is required.");
const stage = process.argv.includes("--stage");
if (stage) await exec("git",["add","--",...files],{maxBuffer:2*1024*1024});
const report = {branch,fileCount:files.length,files,staged:stage,secretsExcluded:true,mainPublicFilesUnchanged:true,push:false,deploy:false};
await fs.mkdir(".cms-local/preflight",{recursive:true});
await writeAuditReport(".cms-local/preflight/release-stage.json",report);
console.log(JSON.stringify({branch,fileCount:files.length,staged:stage,secretsExcluded:true,push:false,deploy:false}));
