import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { randomBytes } from "node:crypto";
import { passwordHash } from "../src/auth.js";

const salt = randomBytes(24).toString("base64");
const password = "test-runtime-only-unique-password";
const account = {
  username: "testadmin",
  name: "آزمون",
  role: "admin",
  salt,
  hash: await passwordHash(password, salt),
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: "cms-runtime-test",
    modules: true,
    scriptPath: ".wrangler/dry-run/cms-worker.js",
    compatibilityDate: "2026-07-09",
    durableObjects: {
      CMS_GUARD: { className: "CMSLoginGuard", useSQLite: true },
    },
    bindings: {
      CMS_USERS: JSON.stringify([account]),
      CMS_SESSION_SECRET: randomBytes(48).toString("base64"),
      CMS_GITHUB_TOKEN: "runtime-test-not-a-real-token",
      CMS_REPOSITORY: "aikalantar/baran-towel-site",
      CMS_BRANCH: "main",
    },
  }),
);
const post = (body) => ({
  method: "POST",
  headers: {
    Origin: "https://luxtowelco.com",
    "Content-Type": "application/json",
    "X-CMS-Request": "1",
    "CF-Connecting-IP": "192.0.2.10",
  },
  body: JSON.stringify(body),
});
try {
  const result = await mf.dispatchFetch(
    "https://luxtowelco.com/api/cms/login",
    post({ username: account.username, password }),
  );
  assert.equal(result.status, 200, await result.text());
  const cookie = result.headers.get("Set-Cookie");
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("Secure"));
  assert.ok(cookie.includes("SameSite=Strict"));
  const session = await mf.dispatchFetch(
    "https://luxtowelco.com/api/cms/session",
    { headers: { Cookie: cookie.split(";")[0] } },
  );
  assert.equal((await session.json()).user.username, account.username);
  let limited;
  for (let i = 0; i < 8; i++)
    limited = await mf.dispatchFetch(
      "https://luxtowelco.com/api/cms/login",
      post({ username: account.username, password: "wrong-password" }),
    );
  assert.equal(limited.status, 429);
  const forbidden = await mf.dispatchFetch(
    "https://luxtowelco.com/api/cms/publish",
    {
      ...post({}),
      headers: {
        ...post({}).headers,
        Origin: "https://example.invalid",
        Cookie: cookie.split(";")[0],
      },
    },
  );
  assert.equal(forbidden.status, 403);
  console.log(
    JSON.stringify({
      runtime: "Cloudflare workerd",
      login: "passed",
      sessions: "passed",
      durableObjectRateLimit: "passed",
      csrf: "passed",
    }),
  );
} finally {
  await mf.dispose();
}
