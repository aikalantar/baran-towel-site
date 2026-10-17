import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { GitHubRepository } from "../src/github.js";
import { CMSFailure } from "../src/content.js";

const id = value => createHash("sha1").update(value).digest("hex");
export async function githubSimulation() {
  const files = new Map();
  const walk = async dir => { for (const entry of await fs.readdir(dir,{withFileTypes:true})) { const path = `${dir}/${entry.name}`; if(entry.isDirectory()) await walk(path); else files.set(path,await fs.readFile(path)); } };
  await walk("public");
  const state = { head:id("initial fixture"), files, commits:[], blobs:new Map(), trees:new Map(), snapshots:new Map(), fail:false, race:false };
  state.snapshots.set(state.head,new Map(files));
  const repo = new GitHubRepository({CMS_REPOSITORY:"fixture/isolated",CMS_BRANCH:"main",CMS_GITHUB_TOKEN:"fixture-only"});
  repo.call = async (endpoint, method = "GET", body) => {
    if (state.fail && method !== "GET") throw new CMSFailure("خطای شبیه‌سازی GitHub",502);
    if (endpoint === "git/ref/heads/main") return {object:{sha:state.head}};
    if (endpoint.startsWith("contents/")) {
      const [raw,query] = endpoint.slice(9).split("?"), ref = new URLSearchParams(query).get("ref");
      const source = ref && ref !== "main" ? state.snapshots.get(ref) : state.files, content = source?.get(raw);
      if (!content) throw new CMSFailure("فایل آزمایش پیدا نشد.",404);
      return {content:content.toString("base64"),encoding:"base64",sha:id(content)};
    }
    if (endpoint.startsWith("git/trees/") && method === "GET") {
      const ref = endpoint.slice(10).split("?")[0], snapshot = state.snapshots.get(ref) || state.files;
      return {tree:[...snapshot].map(([path,content])=>({path,type:"blob",sha:id(content),size:content.length}))};
    }
    if (endpoint.startsWith("git/commits/") && method === "GET") return {sha:endpoint.slice(12),tree:{sha:endpoint.slice(12)}};
    if (endpoint === "git/blobs") { const content = Buffer.from(body.content,body.encoding === "base64" ? "base64" : "utf8"), sha = id(content); state.blobs.set(sha,content); return {sha}; }
    if (endpoint === "git/trees") { const sha = id(JSON.stringify(body)); state.trees.set(sha,body); return {sha}; }
    if (endpoint === "git/commits") { const sha = id(JSON.stringify(body)); state.commits.push({...body,sha}); return {sha}; }
    if (endpoint === "git/refs/heads/main") {
      const commit = state.commits.find(c => c.sha === body.sha);
      if (body.force !== false || state.race || commit.parents[0] !== state.head) throw new CMSFailure("تعارض هم‌زمان شبیه‌سازی‌شده",409);
      const tree = state.trees.get(commit.tree), next = new Map(state.files);
      for (const entry of tree.tree) next.set(entry.path,state.blobs.get(entry.sha));
      state.files = next; state.head = commit.sha; state.snapshots.set(state.head,new Map(next)); return {};
    }
    if (endpoint.startsWith("deployments?")) return [];
    throw new Error(`Unsupported simulation endpoint: ${method} ${endpoint.split("?")[0]}`);
  };
  return {repo,state};
}
