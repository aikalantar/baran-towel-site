import fs from "node:fs/promises";
import path from "node:path";

// Never log this result or pass credential values as command-line arguments.
export async function readLocalSecrets(root = process.cwd()) {
  const files = [], configs = [];
  for (const relative of [".cms-local/secrets.json",".dev.vars"]) {
    let raw;
    try { raw = await fs.readFile(path.join(root,relative),"utf8"); }
    catch (error) { if (error.code === "ENOENT") continue; throw new Error("Local credential file could not be read."); }
    let config;
    try {
      config = relative.endsWith(".json") ? JSON.parse(raw) : Object.fromEntries(raw.split(/\r?\n/).filter(line=>line.trim() && !line.trim().startsWith("#")).map(line=>{
        const index = line.indexOf("="); if (index < 1) throw new Error();
        const value = line.slice(index+1).trim();
        return [line.slice(0,index).trim(),value.startsWith('"') ? JSON.parse(value) : value.startsWith("'") && value.endsWith("'") ? value.slice(1,-1) : value];
      }));
    } catch { throw new Error("Local credential file has invalid syntax."); }
    files.push({relative,raw,config}); configs.push(config);
  }
  const config = Object.assign({},...configs), values = new Set();
  const collect = (value,key="") => {
    if (typeof value === "string") {
      if (/(?:password|passwd|token|secret|cookie|authorization|salt|hash|CMS_USERS)/i.test(key) && value.length >= 3) values.add(value);
      if (key === "CMS_USERS") { try { collect(JSON.parse(value)); } catch {} }
    } else if (Array.isArray(value)) value.forEach(v=>collect(v));
    else if (value && typeof value === "object") for (const [k,v] of Object.entries(value)) collect(v,k);
  };
  configs.forEach(c=>collect(c));
  return {files,config,values:[...values]};
}
