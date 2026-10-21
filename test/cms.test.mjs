import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { parseHTML } from "linkedom";
import {
  describePage,
  applyChanges,
  preview,
  articleHTML,
  addArticleToIndex,
  readContacts,
  applyContacts,
  pagePath,
} from "../src/content.js";
import { handleCMS } from "../src/cms-worker.js";
import { passwordHash, login, session, bytes64, digest } from "../src/auth.js";
import { GitHubRepository } from "../src/github.js";

const home = await fs.readFile("public/index.html", "utf8");
const catalog = await fs.readFile("public/catalog/index.html", "utf8");
const articleTemplate = await fs.readFile(
  "public/blog/rahnamaye-kharid-hole-luxury/index.html",
  "utf8",
);
const blogIndex = await fs.readFile("public/blog/index.html", "utf8");
const rawImage = await fs.readFile("public/assets/products/mozhan.webp");
const image = {
  path: `public/assets/uploads/${await digest(rawImage)}.webp`,
  mime: "image/webp",
  data: rawImage.toString("base64"),
  width: 640,
  height: 853,
};
const account = {
  username: "owner",
  name: "مدیر",
  role: "admin",
  salt: bytes64(crypto.getRandomValues(new Uint8Array(24))),
};
account.hash = await passwordHash(
  "a-long-and-unique-test-password",
  account.salt,
);
const env = {
  CMS_USERS: JSON.stringify([account]),
  CMS_SESSION_SECRET: "test-only-".repeat(8),
  CMS_GITHUB_TOKEN: "test-only-not-a-real-token",
  CMS_GUARD: {
    idFromName: (id) => id,
    get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
  },
};
const request = (endpoint, body, cookie) =>
  new Request("https://luxtowelco.com/api/cms" + endpoint, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined
        ? {}
        : {
            Origin: "https://luxtowelco.com",
            "X-CMS-Request": "1",
            "Content-Type": "application/json",
          }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const cookie = (
  await login(request("/login", {}), env, {
    username: account.username,
    password: "a-long-and-unique-test-password",
  })
).split(";")[0];
class MemoryRepository {
  constructor() {
    this.files = new Map([
      ["public/index.html", home],
      ["public/catalog/index.html", catalog],
      ["public/blog/index.html", blogIndex],
      ["public/blog/rahnamaye-kharid-hole-luxury/index.html", articleTemplate],
      ["public/sitemap.xml", "<urlset></urlset>"],
    ]);
    this.commits = [];
  }
  async head() {
    return "a".repeat(40);
  }
  async tree() {
    return [...this.files.keys(), ...(await allImages())].map((path) => ({
      path,
    }));
  }
  async read(path) {
    if (!this.files.has(path)) throw new Error("Unexpected file " + path);
    return { content: this.files.get(path), sha: "revision-1" };
  }
  async commit(base, changes, message) {
    this.commits.push({ base, changes, message });
    return { sha: "b".repeat(40), mode: "github" };
  }
  async history() {
    return [];
  }
}
let imagePaths;
async function allImages() {
  if (imagePaths) return imagePaths;
  const walk = async (directory) =>
    (
      await Promise.all(
        (await fs.readdir(directory, { withFileTypes: true })).map(
          async (entry) =>
            entry.isDirectory()
              ? walk(directory + "/" + entry.name)
              : [directory + "/" + entry.name],
        ),
      )
    ).flat();
  imagePaths = (await walk("public")).filter((f) =>
    /\.(webp|png|jpg|jpeg)$/.test(f),
  );
  return imagePaths;
}
test("every public page exposes editable fields and preserves scripts and valid metadata", async () => {
  const paths = [
    "public/index.html",
    "public/en/index.html",
    "public/catalog/index.html",
    "public/en/catalog/index.html",
    "public/bridal-towels/index.html",
    "public/blog/index.html",
    "public/en/blog/index.html",
    "public/blog/rahnamaye-kharid-hole-luxury/index.html",
    "public/en/blog/how-to-choose-luxury-towels/index.html",
  ];
  for (const path of paths) {
    const html = await fs.readFile(path, "utf8");
    const description = describePage(html, path, "test");
    assert.ok(description.fields.some((f) => f.kind === "text"));
    assert.ok(description.fields.some((f) => f.kind === "image"));
    assert.ok(description.fields.some((f) => f.id === "seo-title"));
    const roundtrip = applyChanges(html);
    const { document } = parseHTML(roundtrip);
    assert.equal(document.querySelectorAll("h1").length, 1);
    assert.ok(document.querySelector('script[src="/script.df5cebe557.js"]'));
    for (const script of document.querySelectorAll(
      'script[type="application/ld+json"]',
    ))
      assert.doesNotThrow(() => JSON.parse(script.textContent));
  }
});
test("text editing escapes HTML and retains nested links", () => {
  const page = describePage(home, "public/index.html", "r");
  const field = page.fields.find((f) => f.label === "عنوان اصلی");
  const html = applyChanges(home, [
    { id: field.id, value: "عنوان <script>alert(1)</script>" },
  ]);
  const { document } = parseHTML(html);
  assert.equal(
    document.querySelector("h1").textContent,
    "عنوان <script>alert(1)</script>",
  );
  assert.equal(document.querySelectorAll("h1 script").length, 0);
  assert.ok(document.querySelector(".primary-nav a"));
});
test("SEO changes synchronize social metadata and reject blank values", () => {
  const { document } = parseHTML(
    applyChanges(home, [{ id: "seo-title", value: "عنوان جدید برند" }]),
  );
  assert.equal(document.title, "عنوان جدید برند");
  assert.equal(
    document.querySelector('meta[property="og:title"]').getAttribute("content"),
    "عنوان جدید برند",
  );
  assert.equal(
    document
      .querySelector('meta[name="twitter:title"]')
      .getAttribute("content"),
    "عنوان جدید برند",
  );
  assert.throws(() => applyChanges(home, [{ id: "seo-title", value: "" }]));
});
test("unsafe links and paths never become writable", () => {
  const link = describePage(home, "public/index.html", "r").fields.find(
    (f) => f.kind === "link",
  );
  for (const value of [
    "javascript:alert(1)",
    "//evil.test",
    "data:text/html,test",
    "/\\evil.test",
  ])
    assert.throws(() => applyChanges(home, [{ id: link.id, value }]));
  for (const path of [
    ".git/config",
    "public/admin/index.html",
    "public/../wrangler.jsonc",
    "public/index.js",
  ])
    assert.throws(() => pagePath(path));
});
test("image replacement updates picture sources, preload, dimensions and accessibility", () => {
  const field = describePage(home, "public/index.html", "r").fields.find((f) =>
    f.value.includes("home/baran-hero.webp"),
  );
  const html = applyChanges(home, [
    {
      id: field.id,
      value: "/assets/products/mozhan.webp",
      alt: "مدل موژان",
      width: 640,
      height: 853,
    },
  ]);
  const { document } = parseHTML(html);
  const img = document.querySelector(".hero-media");
  assert.equal(img.getAttribute("src"), "/assets/products/mozhan.webp");
  assert.equal(img.getAttribute("width"), "640");
  assert.equal(img.closest("picture").querySelectorAll("source").length, 0);
  assert.equal(
    document.querySelector('link[as="image"]').getAttribute("href"),
    "/assets/products/mozhan.webp",
  );
  assert.equal(
    document.querySelector('meta[property="og:image"]').getAttribute("content"),
    "https://luxtowelco.com/assets/products/mozhan.webp",
  );
});
test("alt-only changes preserve responsive image sources", () => {
  const field = describePage(home, "public/index.html", "r").fields.find((f) =>
    f.value.includes("home/baran-hero.webp"),
  );
  const { document } = parseHTML(
    applyChanges(home, [{ ...field, alt: "شرح تازه" }]),
  );
  assert.equal(
    document.querySelector("picture source").getAttribute("srcset"),
    "/assets/images/home/baran-hero-640.webp",
  );
});
test("preview removes scripts, navigation, frames and inline handlers", () => {
  const { document } = parseHTML(
    preview(
      home.replace(
        "<main",
        '<iframe src="https://example.com"></iframe><main onclick="alert(1)"',
      ),
    ),
  );
  assert.equal(
    document.querySelectorAll("script,iframe,[onclick],a[href]").length,
    0,
  );
  assert.ok(document.querySelector("main"));
});
test("catalog operations synchronize quick navigation and ItemList schema", () => {
  const html = applyChanges(
    catalog,
    [],
    [
      {
        type: "duplicate",
        id: "sanam",
        newId: "fresh-model",
        name: "مدل تازه",
      },
      { type: "up", id: "fresh-model" },
      { type: "remove", id: "teyho" },
    ],
  );
  const { document } = parseHTML(html);
  assert.equal(document.querySelectorAll(".product-card").length, 6);
  assert.equal(
    document.querySelector("#fresh-model h2").textContent,
    "مدل تازه",
  );
  assert.equal(document.querySelector("#teyho"), null);
  assert.equal(
    document.querySelector(".model-index a").getAttribute("href"),
    "#fresh-model",
  );
  const graph = JSON.parse(
    document.querySelector('script[type="application/ld+json"]').textContent,
  )["@graph"];
  assert.equal(graph[0].mainEntity.numberOfItems, 6);
  assert.ok(
    graph[0].mainEntity.itemListElement.some((i) => i.name === "مدل تازه"),
  );
});
test("a new model can have its own specs, price and image before publication", () => {
  const originalImage = parseHTML(catalog).document
    .querySelector("#sanam img").getAttribute("src");
  const fields = describePage(catalog, "public/catalog/index.html", "r").fields;
  const color = fields.find(
    (f) => f.model === "sanam" && f.label === "مشخصه: رنگ",
  );
  const html = applyChanges(
    catalog,
    [],
    [
      {
        type: "duplicate",
        id: "sanam",
        newId: "new-model",
        name: "مدل جدید",
        updates: [{ id: color.id, value: "آبی" }],
        image: {
          value: "/assets/products/mozhan.webp",
          alt: "مدل جدید",
          width: 640,
          height: 853,
        },
      },
    ],
  );
  const { document } = parseHTML(html);
  assert.equal(
    document.querySelector("#new-model .spec-list dd").textContent,
    "آبی",
  );
  assert.equal(
    document.querySelector("#new-model img").getAttribute("src"),
    "/assets/products/mozhan.webp",
  );
  assert.equal(
    document.querySelector("#sanam img").getAttribute("src"),
    originalImage,
  );
});
test("new articles escape untrusted HTML and appear in the existing blog layout", () => {
  const article = articleHTML(articleTemplate, {
    slug: "safe-new-article",
    title: "عنوان آزمایشی",
    description: "توضیح آزمایشی",
    body: "## عنوان بخش\n\n<script>alert(1)</script>\n\n- مورد اول\n- مورد دوم",
    image: "/assets/products/mozhan.webp",
  });
  const { document } = parseHTML(article.html);
  assert.equal(document.querySelectorAll(".article-body script").length, 0);
  assert.equal(document.querySelectorAll(".article-body h2").length, 1);
  assert.equal(document.querySelectorAll(".article-body li").length, 2);
  assert.equal(
    document.querySelector('link[rel="canonical"]').getAttribute("href"),
    "https://luxtowelco.com/blog/safe-new-article/",
  );
  const index = parseHTML(addArticleToIndex(blogIndex, article)).document;
  assert.equal(index.querySelectorAll(".blog-list").length, 2);
  assert.ok(index.querySelector('a[href="/blog/safe-new-article/"]'));
});
test("shared contact edits retain WhatsApp inquiry messages and update structured data", () => {
  const before = readContacts(home);
  const after = {
    ...before,
    phone: "+989121234567",
    email: "new@example.com",
    whatsapp: "https://wa.me/989121234567",
    address: "تهران، ایران",
  };
  const { document } = parseHTML(applyContacts(home, after));
  assert.ok(document.querySelector('a[href="tel:+989121234567"]'));
  assert.ok(
    document.querySelector('a[href^="https://wa.me/989121234567?text="]'),
  );
  assert.equal(
    document.querySelector('a[href^="mailto:"]').textContent,
    "new@example.com",
  );
  assert.equal(
    JSON.parse(
      document.querySelector('script[type="application/ld+json"]').textContent,
    ).contactPoint.telephone,
    after.phone,
  );
});
test("production APIs fail closed without configuration or authentication", async () => {
  const r = await handleCMS(request("/library"), {});
  assert.equal(r.status, 401);
  const state = await (await handleCMS(request("/session"), {})).json();
  assert.equal(state.configured, false);
  assert.equal(state.user, null);
});
test("session signatures, password changes and login attempt limits are enforced", async () => {
  assert.equal(
    (await session(request("/session", undefined, cookie), env)).username,
    "owner",
  );
  assert.equal(
    await session(request("/session", undefined, cookie + "broken"), env),
    null,
  );
  const changed = {
    ...env,
    CMS_USERS: JSON.stringify([{ ...account, hash: "different-hash" }]),
  };
  assert.equal(
    await session(request("/session", undefined, cookie), changed),
    null,
  );
  const limited = {
    ...env,
    CMS_GUARD: {
      idFromName: (id) => id,
      get: () => ({ fetch: async () => new Response(null, { status: 429 }) }),
    },
  };
  const r = await handleCMS(
    request("/login", { username: "owner", password: "wrong" }),
    limited,
  );
  assert.equal(r.status, 429);
  const wrong = await handleCMS(
    request("/login", { username: "owner", password: "wrong" }),
    env,
  );
  assert.equal(wrong.status, 401);
});
test("cross-origin state-changing requests are refused", async () => {
  const r = await handleCMS(
    new Request("https://luxtowelco.com/api/cms/publish", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://evil.test",
        "Content-Type": "application/json",
        "X-CMS-Request": "1",
      },
      body: "{}",
    }),
    env,
    { repo: new MemoryRepository() },
  );
  assert.equal(r.status, 403);
});
test("stale revisions cannot overwrite an edited page", async () => {
  const repo = new MemoryRepository();
  const r = await handleCMS(
    request(
      "/publish",
      { path: "public/index.html", revision: "old", updates: [] },
      cookie,
    ),
    env,
    { repo },
  );
  assert.equal(r.status, 409);
  assert.equal(repo.commits.length, 0);
});
test("page and validated image publish together in one commit", async () => {
  const repo = new MemoryRepository();
  const field = describePage(
    home,
    "public/index.html",
    "revision-1",
  ).fields.find((f) => f.value.includes("home/baran-hero.webp"));
  const r = await handleCMS(
    request(
      "/publish",
      {
        path: "public/index.html",
        revision: "revision-1",
        updates: [
          {
            id: field.id,
            value: "/" + image.path.slice(7),
            alt: "تصویر تازه",
            width: 640,
            height: 853,
          },
        ],
        images: [image],
      },
      cookie,
    ),
    env,
    { repo },
  );
  assert.equal(r.status, 200, await r.text());
  assert.equal(repo.commits.length, 1);
  assert.equal(repo.commits[0].changes.length, 2);
  assert.equal(repo.commits[0].changes[1].encoding, "base64");
});
test("disguised SVG uploads and missing image files are rejected before publication", async () => {
  const repo = new MemoryRepository();
  const bad = {
    ...image,
    data: Buffer.from('<svg onload="alert(1)">invalid image</svg>').toString(
      "base64",
    ),
  };
  let r = await handleCMS(
    request(
      "/publish",
      { path: "public/index.html", revision: "revision-1", images: [bad] },
      cookie,
    ),
    env,
    { repo },
  );
  assert.equal(r.status, 400);
  const field = describePage(home, "public/index.html", "r").fields.find(
    (f) => f.kind === "image",
  );
  r = await handleCMS(
    request(
      "/publish",
      {
        path: "public/index.html",
        revision: "revision-1",
        updates: [
          {
            id: field.id,
            value: "/assets/missing.webp",
            alt: "missing",
            width: 10,
            height: 10,
          },
        ],
      },
      cookie,
    ),
    env,
    { repo },
  );
  assert.equal(r.status, 400);
  assert.equal(repo.commits.length, 0);
});
test("editor accounts preview and publish permitted legacy content", async () => {
  const editor = { ...account, role: "editor" };
  const editorEnv = { ...env, CMS_USERS: JSON.stringify([editor]) };
  const c = (
    await login(request("/login", {}), editorEnv, {
      username: "owner",
      password: "a-long-and-unique-test-password",
    })
  ).split(";")[0];
  const repo = new MemoryRepository();
  const field = describePage(home, "public/index.html", "r").fields.find(
    (f) => f.label === "عنوان اصلی",
  );
  const body = {
    path: "public/index.html",
    revision: "revision-1",
    updates: [{ id: field.id, value: "عنوان تازه" }],
  };
  assert.equal(
    (await handleCMS(request("/preview", body, c), editorEnv, { repo })).status,
    200,
  );
  assert.equal(
    (await handleCMS(request("/publish", body, c), editorEnv, { repo })).status,
    200,
  );
  assert.equal(repo.commits.length, 1);
});
test("article publication updates the article, journal and sitemap atomically", async () => {
  const repo = new MemoryRepository();
  const r = await handleCMS(
    request(
      "/publish",
      {
        head: await repo.head(),
        article: {
          slug: "new-test-post",
          title: "مقاله آزمایشی",
          description: "توضیح مقاله",
          body: "متن آزمایشی",
        },
        images: [],
      },
      cookie,
    ),
    env,
    { repo },
  );
  assert.equal(r.status, 200, await r.text());
  assert.equal(repo.commits.length, 1);
  assert.equal(repo.commits[0].changes.length, 3);
  assert.ok(
    repo.commits[0].changes
      .find((c) => c.path === "public/sitemap.xml")
      .content.includes("/blog/new-test-post/"),
  );
});
test("GitHub publication never forces a branch update or rewrites concurrent work", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const endpoint = url.split("/baran-towel-site/")[1];
    calls.push({ endpoint, options });
    if (endpoint.startsWith("git/ref/"))
      return Response.json({ object: { sha: "a".repeat(40) } });
    if (endpoint.startsWith("git/commits/"))
      return Response.json({ tree: { sha: "tree" } });
    if (endpoint === "git/blobs") return Response.json({ sha: "blob" });
    if (endpoint === "git/trees") return Response.json({ sha: "newtree" });
    if (endpoint === "git/commits")
      return Response.json({ sha: "b".repeat(40) });
    if (endpoint.startsWith("git/refs/"))
      return Response.json({ message: "non-fast-forward" }, { status: 422 });
    throw new Error(endpoint);
  };
  try {
    const repo = new GitHubRepository({
      CMS_REPOSITORY: "aikalantar/baran-towel-site",
      CMS_GITHUB_TOKEN: "test",
    });
    await assert.rejects(
      () =>
        repo.commit(
          "a".repeat(40),
          [{ path: "public/index.html", content: "test" }],
          "test",
        ),
      (error) => error.status === 409,
    );
    const update = calls.find((c) => c.options.method === "PATCH");
    assert.equal(JSON.parse(update.options.body).force, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
