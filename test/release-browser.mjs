import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startLocal } from "../scripts/cms-local.mjs";
import { writeAuditReport } from "../scripts/audit-redact.mjs";

const exec = promisify(execFile), folder = path.resolve(".cms-local/preflight");
await fs.mkdir(folder,{recursive:true});
const profile = await fs.mkdtemp(path.join(folder,"chrome-")), server = await startLocal(process.cwd(),0);
const context = await chromium.launchPersistentContext(profile,{channel:"chrome",headless:true,args:["--remote-debugging-port=0"]});
try {
  const active = (await fs.readFile(path.join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0];
  const env = {...process.env,BROWSER_SMOKE_CDP_URL:`http://127.0.0.1:${active}`,SITE_AUDIT_BASE_URL:`http://127.0.0.1:${server.address().port}`};
  let result, successful = true;
  try { result = await exec(process.execPath,["test/browser-smoke.mjs"],{env,timeout:180000,maxBuffer:3*1024*1024}); }
  catch(error) { successful = false; result = {stdout:error.stdout}; }
  let data;
  try { data = JSON.parse(result.stdout); } catch { data = {failure:"Browser smoke runner did not return a structured report"}; }
  await writeAuditReport(path.join(folder,"site-browser-report.json"),data);
  console.log(JSON.stringify({passed:successful,scenarios:data.results?.length || 0,consoleErrors:data.consoleErrors?.length || 0,reducedMotion:data.reducedMotion === true}));
  if (!successful) process.exitCode = 1;
} finally { await context.close(); await new Promise(resolve=>server.close(resolve)); }
