import { CMSFailure,SITE } from "./content.js";
import {cloudflareDeployment,providerURL} from './deployment.js';
import {publicPublicationProof} from './publication-proof.js';

export class GitHubRepository {
  constructor(env) {
    this.repository = env.CMS_REPOSITORY;
    this.branch = env.CMS_BRANCH || "main";
    this.token = env.CMS_GITHUB_TOKEN;
    this.publicOrigin=env.CMS_SITE_ID||SITE;
    this.deploymentConfig = {CMS_CF_ACCOUNT_ID:env.CMS_CF_ACCOUNT_ID,CMS_CF_WORKER_NAME:env.CMS_CF_WORKER_NAME,CMS_CF_API_TOKEN:env.CMS_CF_API_TOKEN};
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(this.repository) ||
      !/^[\w.-]+$/.test(this.branch)
    )
      throw new CMSFailure("تنظیم مخزن معتبر نیست.", 503);
  }
  async call(path, method = "GET", body) {
    let response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${this.repository}/${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "LuxTowelCo-CMS",
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(25000),
        },
      );
    } catch {
      throw new CMSFailure(
        "ارتباط با مخزن برقرار نشد؛ پیش‌نویس شما محفوظ است.",
        502,
      );
    }
    if (!response.ok) {
      if (response.status === 404)
        throw new CMSFailure(
          "فایل یا مخزن پیدا نشد؛ دسترسی پنل را بررسی کنید.",
          404,
        );
      if (response.status === 409 || response.status === 422)
        throw new CMSFailure(
          "نسخه جدیدتری ثبت شده است. صفحه را تازه کنید و تغییرات را دوباره بررسی کنید.",
          409,
        );
      if (response.status === 401 || response.status === 403)
        throw new CMSFailure(
          "دسترسی امن GitHub نیاز به بررسی یا تمدید دارد.",
          503,
        );
      throw new CMSFailure("ثبت در مخزن انجام نشد؛ دوباره تلاش کنید.", 502);
    }
    return response.status === 204 ? null : response.json();
  }
  async head() {
    const ref = await this.call(`git/ref/heads/${this.branch}`);
    return ref.object.sha;
  }
  async tree(ref) {
    const data = await this.call(`git/trees/${ref}?recursive=1`);
    if (data.truncated)
      throw new CMSFailure(
        "فهرست مخزن بسیار بزرگ است و نیاز به بررسی دارد.",
        503,
      );
    return data.tree.filter((entry) => entry.type === "blob");
  }
  async read(path, ref) {
    const file = await this.call(
      `contents/${path}?ref=${encodeURIComponent(ref || this.branch)}`,
    );
    if (!file.content || file.encoding !== "base64")
      throw new CMSFailure("فایل برای ویرایش مناسب نیست.", 400);
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, "")), (c) =>
      c.charCodeAt(0),
    );
    return { content: new TextDecoder().decode(bytes), sha: file.sha };
  }
  async readBytes(path, ref) {
    let file = await this.call(`contents/${path}?ref=${encodeURIComponent(ref || this.branch)}`);
    if ((!file.content || file.encoding !== "base64") && /^[a-f0-9]{40}$/.test(file.sha || "")) file = await this.call(`git/blobs/${file.sha}`);
    if (!file.content || file.encoding !== "base64") throw new CMSFailure("تصویر قابل خواندن نیست.");
    return Uint8Array.from(atob(file.content.replace(/\s/g,"")), c => c.charCodeAt(0));
  }
  async publicationStatus(sha,options={}) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new CMSFailure("شناسه انتشار معتبر نیست.");
    // A generic successful build check is not proof of a production deployment.
    const result = { commit:"unknown", deployment:"unknown", stage:"unverified", evidence:null, checkedAt:new Date().toISOString() };
    try {
      const commit = await this.call(`git/commits/${sha}`);
      if (commit.sha !== sha) return result;
      result.commit = "committed";
      result.stage = "commit_created";
      if ((await this.head()) !== sha) return {...result,deployment:"superseded",reason:"newer_commit_exists"};
      const cloudflare=await cloudflareDeployment(this.deploymentConfig,sha,this.repository,this.branch);
      if(cloudflare?.deployment==='success') {
        if((await this.head())!==sha)return {...result,deployment:'superseded',reason:'newer_commit_exists'};
        return {...result,...cloudflare};
      }
      const trusted = actor => actor?.type === "Bot" && ["cloudflare-workers-and-pages[bot]","cloudflare-pages[bot]"].includes(actor.login);
      let deployments=[];
      try{deployments=await this.call("deployments?per_page=100");}catch{/* Public content can still provide independent publication evidence. */}
      const production = (Array.isArray(deployments)?deployments:[]).filter(d => d.production_environment === true && trusted(d.creator)).sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0))[0];
      let latest;
      if(production?.sha===sha){try{latest=(await this.call(`deployments/${production.id}/statuses?per_page=1`))[0];}catch{/* Fall back to the independently served artifacts. */}}
      if(latest&&trusted(latest.creator)){
      result.deployment = ["success","failure","error","inactive","queued","pending","in_progress"].includes(latest.state) ? latest.state : "unknown";
      result.stage = result.deployment === "success" ? "deployment_verified" : ["queued","pending","in_progress"].includes(result.deployment) ? "deployment_started" : ["failure","error"].includes(result.deployment) ? "deployment_failed" : "commit_created";
      result.evidence = "github-cloudflare-production-deployment";
      if((await this.head())!==sha)return {...result,deployment:'superseded',stage:'commit_created',evidence:null,reason:'newer_commit_exists'};
      const url=providerURL(latest.log_url);if(url)result.url=url;
      if(result.deployment==='success')return result;
      }
      const proof=await publicPublicationProof(this,sha,options);
      if((await this.head())!==sha)return {...result,deployment:'superseded',stage:'commit_created',evidence:null,reason:'newer_commit_exists'};
      if(proof.deployment==='success')return {...result,...proof,evidence:proof.evidence};
      result.reason=cloudflare?.reason||proof.reason||'provider_evidence_unavailable';
    } catch { result.deployment = "unknown"; result.reason="provider_evidence_unavailable"; }
    return result;
  }
  async commit(base, changes, message) {
    if ((await this.head()) !== base)
      throw new CMSFailure(
        "هم‌زمان تغییر دیگری ثبت شده است؛ ابتدا نسخه جدید را بارگذاری کنید.",
        409,
      );
    const parent = await this.call(`git/commits/${base}`);
    const tree = [];
    // Sequential writes stay within Workers' simultaneous connection limits.
    for (const change of changes) {
      if (change.delete === true) {
        tree.push({path:change.path,mode:"100644",type:"blob",sha:null});
        continue;
      }
      const blob = await this.call("git/blobs", "POST", {
        content: change.content,
        encoding: change.encoding || "utf-8",
      });
      tree.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }
    const nextTree = await this.call("git/trees", "POST", {
      base_tree: parent.tree.sha,
      tree,
    });
    const commit = await this.call("git/commits", "POST", {
      message,
      tree: nextTree.sha,
      parents: [base],
    });
    await this.call(`git/refs/heads/${this.branch}`, "PATCH", {
      sha: commit.sha,
      force: false,
    });
    return {
      sha: commit.sha,
      url: `https://github.com/${this.repository}/commit/${commit.sha}`,
      mode: "github",
    };
  }
  async history(path) {
    const entries = await this.call(
      `commits?sha=${this.branch}&path=${encodeURIComponent(path)}&per_page=15`,
    );
    return entries.map((entry) => ({
      sha: entry.sha,
      message: entry.commit.message,
      date: entry.commit.committer.date,
      url: entry.html_url,
    }));
  }
  async status(sha) {
    if (!/^[a-f0-9]{40}$/.test(sha))
      throw new CMSFailure("شناسه انتشار معتبر نیست.");
    const result = await this.call(`commits/${sha}/status`);
    return {
      state: result.state,
      checks: result.statuses.map((s) => ({
        name: s.context,
        state: s.state,
        url: s.target_url,
      })),
      url: `https://github.com/${this.repository}/commit/${sha}`,
    };
  }
}
