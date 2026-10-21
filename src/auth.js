import { CMSFailure } from "./content.js";

const encoder = new TextEncoder();
export const bytes64 = (bytes) => {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};
export const from64 = (value) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export const hex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export const digest = async (value) =>
  hex(
    await crypto.subtle.digest(
      "SHA-256",
      typeof value === "string" ? encoder.encode(value) : value,
    ),
  );
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return bytes64(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: from64(salt),
          iterations: 100000,
          hash: "SHA-256",
        },
        key,
        256,
      ),
    ),
  );
}
function users(env) {
  try {
    const list = JSON.parse(env.CMS_USERS || "[]");
    return Array.isArray(list)
      ? list.filter(
          (u) =>
            /^[a-zA-Z0-9_.-]{2,50}$/.test(u.username) &&
            ["admin", "editor"].includes(u.role) &&
            u.hash &&
            u.salt,
        )
      : [];
  } catch {
    return [];
  }
}
export const configured = (env) =>
  users(env).length > 0 &&
  String(env.CMS_SESSION_SECRET || "").length >= 40 &&
  !!env.CMS_GITHUB_TOKEN &&
  !!env.CMS_GUARD;
async function signingKey(env) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.CMS_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
const cookieName = "__Host-luxcms";
// Bind even deliberately shared signing secrets/accounts to one installation.
const audience = (request,env) => digest(JSON.stringify([new URL(request.url).origin,env.CMS_SITE_ID||'https://luxtowelco.com',env.CMS_REPOSITORY||'',env.CMS_BRANCH||'main']));
export async function session(request, env) {
  if (!configured(env)) return null;
  try {
    const cookie = (request.headers.get("Cookie") || "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (!cookie || cookie.length > 2000) return null;
    const [payload, signature] = cookie.split(".");
    if (
      !signature ||
      !(await crypto.subtle.verify(
        "HMAC",
        await signingKey(env),
        from64(signature),
        encoder.encode(payload),
      ))
    )
      return null;
    const claims = JSON.parse(new TextDecoder().decode(from64(payload)));
    const user = users(env).find((u) => u.username === claims.u);
    if (
      !user ||
      claims.exp < Date.now() || claims.a !== await audience(request,env) ||
      claims.v !== (await digest(user.hash + user.role))
    )
      return null;
    return {
      username: user.username,
      name: user.name || user.username,
      role: user.role,
    };
  } catch {
    return null;
  }
}
export async function login(request, env, body) {
  if (!configured(env))
    throw new CMSFailure(
      "ورود پنل هنوز فعال نشده است. تنظیمات دسترسی را مدیر سایت باید تکمیل کند.",
      503,
    );
  if (
    typeof body.password !== "string" ||
    body.password.length > 200 ||
    typeof body.username !== "string" ||
    body.username.length > 50
  )
    throw new CMSFailure("نام کاربری یا رمز عبور درست نیست.", 401);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const id = env.CMS_GUARD.idFromName(await digest(ip));
  const allowed = await env.CMS_GUARD.get(id).fetch("https://guard/attempt", {
    method: "POST",
  });
  if (!allowed.ok)
    throw new CMSFailure(
      "تلاش‌های ورود بیش از حد است؛ ۱۵ دقیقه دیگر دوباره امتحان کنید.",
      429,
    );
  const user = users(env).find((u) => u.username === body.username);
  const dummy = users(env)[0];
  const hash = await passwordHash(body.password, (user || dummy).salt);
  if (!user || hash !== user.hash)
    throw new CMSFailure("نام کاربری یا رمز عبور درست نیست.", 401);
  const payload = bytes64(
    encoder.encode(
      JSON.stringify({
        u: user.username,
        a: await audience(request,env),
        exp: Date.now() + 8 * 60 * 60 * 1000,
        v: await digest(user.hash + user.role),
      }),
    ),
  );
  const signature = bytes64(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await signingKey(env),
        encoder.encode(payload),
      ),
    ),
  );
  return `${cookieName}=${payload}.${signature}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`;
}
export const logoutCookie = () =>
  `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
export class CMSLoginGuard {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async fetch() {
    const allowed = await this.ctx.storage.transaction(async (tx) => {
      let current = await tx.get("attempts");
      if (!current || current.until < Date.now())
        current = { count: 0, until: Date.now() + 15 * 60 * 1000 };
      current.count++;
      await tx.put("attempts", current);
      return current.count <= 8;
    });
    await this.ctx.storage.setAlarm(Date.now() + 16 * 60 * 1000);
    return new Response(null, { status: allowed ? 204 : 429 });
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
