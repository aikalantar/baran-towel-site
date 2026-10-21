import {
  CMSFailure,
  pagePath,
  describePage,
  applyChanges,
  preview,
  articleHTML,
  addArticleToIndex,
  readContacts,
  applyContacts,
  SITE,
} from "./content.js";
import {
  configured,
  session,
  login,
  logoutCookie,
  from64,
  digest,
} from "./auth.js";
import { GitHubRepository } from "./github.js";
import { builderPage, publishBuilder, previewBuilder } from "./builder.js";
import { listPages, preparePage, pageAction,generatedPagePath } from "./pages.js";
import {cmsPermissions,contentUser,canAccessPage,assertPageAccess,assertPageCreation,assertPageAction,assertContacts,scopedRepository} from './cms-permissions.js';
import {authorizeLegacy,authorizeLegacyResult,authorizeContacts} from './legacy-permissions.js';
import {imageInfo} from '../public/admin/builder/image-format.js';
export { CMSLoginGuard } from "./auth.js";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, ...extra },
  });
async function readBody(request) {
  if (
    !(request.headers.get("Content-Type") || "").startsWith("application/json")
  )
    throw new CMSFailure("نوع درخواست معتبر نیست.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new CMSFailure("درخواست خالی است.");
  let size = 0;
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16 * 1024 * 1024) {
      await reader.cancel();
      throw new CMSFailure("حجم درخواست بیشتر از ۱۶ مگابایت است.", 413);
    }
    parts.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  try {
    const body=JSON.parse(new TextDecoder().decode(merged));
    if(!body||typeof body!=='object'||Array.isArray(body))throw Error();
    return body;
  } catch {
    throw new CMSFailure("محتوای درخواست قابل خواندن نیست.");
  }
}
function sameOrigin(request) {
  if (
    request.headers.get("Origin") !== new URL(request.url).origin ||
    request.headers.get("X-CMS-Request") !== "1"
  ) {
    throw new CMSFailure("درخواست باید از داخل پنل ارسال شود.", 403);
  }
}
async function uploadChanges(images) {
  if (!Array.isArray(images) || images.length > 8)
    throw new CMSFailure("در هر انتشار حداکثر ۸ تصویر اضافه کنید.");
  const changes = [];
  for (const image of images) {
    if (
      !image || typeof image.data !== "string" ||
      image.data.length > 6 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)
    )
      throw new CMSFailure("فایل تصویر معتبر نیست.");
    const bytes = from64(image.data);
    const ascii = (start, end) =>
      String.fromCharCode(...bytes.slice(start, end));
    let ext, mime;
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
      ext = "webp";
      mime = "image/webp";
    } else if (
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
    ) {
      ext = "png";
      mime = "image/png";
    } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      ext = "jpg";
      mime = "image/jpeg";
    } else
      throw new CMSFailure(
        "تنها تصویر واقعی WebP، PNG یا JPEG پذیرفته می‌شود.",
      );
    if (
      image.mime !== mime ||
      bytes.length < 24 ||
      bytes.length > 4 * 1024 * 1024
    )
      throw new CMSFailure("نوع یا حجم تصویر مجاز نیست.");
    const path = `public/assets/uploads/${await digest(bytes)}.${ext}`;
    try{const info=imageInfo(bytes);if(info.mime!==mime||info.width>8000||info.height>8000||info.width*info.height>40000000)throw Error();}catch{throw new CMSFailure('ساختار یا ابعاد فایل تصویر معتبر نیست.');}
    if (image.path !== path)
      throw new CMSFailure("شناسه تصویر با فایل تطابق ندارد.");
    changes.push({ path, content: image.data, encoding: "base64" });
  }
  return changes;
}
export async function handleCMS(request, env, options = {}) {
  try {
    const url = new URL(request.url),
      endpoint = url.pathname.slice("/api/cms".length);
    const localMode =
      options.localMode === true &&
      ["127.0.0.1", "localhost"].includes(url.hostname);
    if (endpoint === "/session" && request.method === "GET") {
      const user = localMode
        ? { username: "local", name: "مدیریت محلی", role: "admin" }
        : contentUser(await session(request, env),env);
      return json({
        user,
        permissions: cmsPermissions(user),
        configured: localMode || configured(env),
        mode: localMode ? "local" : "github",
        site: SITE,
      });
    }
    if (request.method !== "GET") sameOrigin(request);
    if (endpoint === "/login" && request.method === "POST") {
      const cookie = await login(request, env, await readBody(request));
      return json({ ok: true }, 200, { "Set-Cookie": cookie });
    }
    if (endpoint === "/logout" && request.method === "POST")
      return json({ ok: true }, 200, { "Set-Cookie": logoutCookie() });
    const user = localMode
      ? { username: "local", role: "admin" }
      : contentUser(await session(request, env),env);
    if (!user) throw new CMSFailure("برای ادامه وارد پنل شوید.", 401);
    const repo = scopedRepository(options.repo || new GitHubRepository(env),user);
    if(endpoint === "/builder/pages" && request.method === "GET") {
      if(!["admin","editor"].includes(user.role))throw new CMSFailure("دسترسی ویرایش ندارید.",403);
      const inspect=url.searchParams.get('path');if(inspect)assertPageAccess(user,inspect);
      const listing=await listPages(repo,inspect);listing.pages=listing.pages.filter(p=>canAccessPage(user,p.path));return json(listing);
    }
    if(endpoint === "/builder/pages/prepare" && request.method === "POST") {
      if(!["admin","editor"].includes(user.role))throw new CMSFailure("دسترسی ویرایش ندارید.",403);
      const body=await readBody(request);
      assertPageCreation(user,generatedPagePath(body.slug,body.language||'fa'));
      if(!cmsPermissions(user).studio && (body.kind==='duplicate'||body.sourcePath||body.template&&body.template!=='blank'))throw new CMSFailure('طراحی و تکثیر حرفه‌ای فقط برای مدیر مجاز است.',403);
      const prepared=await preparePage(repo,body);
      assertPageCreation(user,prepared.path,prepared.creation);
      const page=builderPage(prepared.content,prepared.revision,prepared.path);
      page.model.base.creation=prepared.creation;
      page.model.page=prepared.creation.page;
      return json(page);
    }
    if(endpoint === "/builder/pages/action" && request.method === "POST") {
      const body=await readBody(request);assertPageAction(user,body);
      return json(await pageAction(repo,body,user,localMode));
    }
    if (endpoint === "/builder" && request.method === "GET") {
      if (!["admin", "editor"].includes(user.role))
        throw new CMSFailure("دسترسی ویرایش ندارید.", 403);
      const path = pagePath(url.searchParams.get("path") || "public/index.html");
      assertPageAccess(user,path);
      const current = await repo.read(path);
      const ref = url.searchParams.get("ref");
      if (ref && !(localMode?/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/:/^[a-f0-9]{40}$/).test(ref)) throw new CMSFailure("نسخه بازگردانی معتبر نیست.");
      const file = ref ? await repo.read(path,ref) : current;
      const page = builderPage(file.content,current.sha,path);
      if (ref) page.model.base.restoreCommit = ref;
      return json(page);
    }
    if(endpoint==='/builder/preview'&&request.method==='POST'){
      if(!['admin','editor'].includes(user.role))throw new CMSFailure('دسترسی ویرایش ندارید.',403);
      const body=await readBody(request);
      return json(await previewBuilder(repo,body?.model,user,body?.unlockIds));
    }
    if (endpoint === "/builder/publish" && request.method === "POST") {
      if (!cmsPermissions(user).publish) throw new CMSFailure('انتشار برای این حساب مجاز نیست.',403);
      return json(await publishBuilder(repo,await readBody(request),user,localMode));
    }
    if (endpoint === "/builder/status" && request.method === "GET")
      return json(await repo.publicationStatus(url.searchParams.get("sha")));
    if (endpoint === "/library" && request.method === "GET") {
      const head = await repo.head();
      const tree = await repo.tree(head);
      return json({
        head,
        pages: tree
          .filter(
            (f) =>
              /^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(f.path) &&
              !f.path.startsWith("public/admin/") && canAccessPage(user,f.path),
          )
          .map((f) => ({
            path: f.path,
            revision: f.sha,
            route: "/" + f.path.slice(7).replace(/index\.html$/, ""),
            language: f.path.startsWith("public/en/") ? "en" : "fa",
          })),
        images: tree
          .filter((f) =>
            /^public\/assets(?:-v[23])?\/.+\.(webp|png|jpg|jpeg)$/i.test(
              f.path,
            ),
          )
          .map((f) => ({
            path: f.path,
            url: "/" + f.path.slice(7),
            size: f.size || 0,
          })),
      });
    }
    if (endpoint === "/page" && request.method === "GET") {
      const path = pagePath(url.searchParams.get("path"));
      assertPageAccess(user,path);
      const current = await repo.read(path);
      const ref = url.searchParams.get("ref");
      if (ref && !/^[a-f0-9]{40}$/.test(ref))
        throw new CMSFailure("نسخه انتخاب‌شده معتبر نیست.");
      const file = ref ? await repo.read(path, ref) : current;
      return json(
        describePage(
          file.content,
          path,
          current.sha,
          ref ? { restoreCommit: ref } : {},
        ),
      );
    }
    if (endpoint === "/history" && request.method === "GET")
      return json({
        entries: await repo.history(assertPageAccess(user,url.searchParams.get("path"))),
      });
    if (endpoint === "/status" && request.method === "GET")
      return json(await repo.status(url.searchParams.get("sha")));
    if (endpoint === "/contacts" && request.method === "GET") {
      const head = await repo.head();
      assertContacts(user,(await repo.tree(head)).filter(f=>/^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(f.path)&&!f.path.startsWith('public/admin/')).map(f=>f.path));
      return json({
        head,
        values: readContacts(
          (await repo.read("public/index.html", head)).content,
        ),
      });
    }
    if (endpoint === '/contacts/preview' && request.method === 'POST') {
      const body=await readBody(request),head=await repo.head();
      if(body.head!==head)throw new CMSFailure('اطلاعات سایت تغییر کرده است؛ پیش‌نویس تماس را نگه دارید و نسخهٔ فعلی را بررسی کنید.',409);
      const path=pagePath(body.path||'public/index.html');
      assertPageAccess(user,path);assertContacts(user,(await repo.tree(head)).filter(f=>/^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(f.path)&&!f.path.startsWith('public/admin/')).map(f=>f.path));
      const current=(await repo.read(path,head)).content,next=applyContacts(current,body.values);authorizeContacts(user,path,current,body.values);
      return json({html:preview(next),draft:true});
    }
    if (endpoint === "/contacts" && request.method === "POST") {
      if (!cmsPermissions(user).publish)
        throw new CMSFailure(
          "فقط مدیر می‌تواند اطلاعات تماس را منتشر کند.",
          403,
        );
      const body = await readBody(request),
        head = await repo.head();
      if (head !== body.head)
        throw new CMSFailure(
          "نسخه سایت تغییر کرده است؛ اطلاعات تماس را دوباره بارگذاری کنید.",
          409,
        );
      const tree = await repo.tree(head),
        changes = [];
      assertContacts(user,tree.filter(f=>/^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(f.path)&&!f.path.startsWith('public/admin/')).map(f=>f.path));
      for (const entry of tree.filter(
        (f) =>
          /^public\/(?:[a-z0-9-]+\/)*index\.html$/.test(f.path) &&
          !f.path.startsWith("public/admin/"),
      )) {
        const current=(await repo.read(entry.path,head)).content,next=applyContacts(current,body.values);authorizeContacts(user,entry.path,current,body.values);
        changes.push({
          path: entry.path,
          content: next,
        });
      }
      return json(
        await repo.commit(
          head,
          changes,
          `content: update contact details via CMS (${user.username})`,
        ),
      );
    }
    if (
      ["/preview", "/publish"].includes(endpoint) &&
      request.method === "POST"
    ) {
      const body = await readBody(request);
      const images = body.images || [];
      const imageChanges = await uploadChanges(images);
      let html, path, file;
      const head = await repo.head();
      const changes = [];
      if (body.article) {
        if(user.role!=='admin'&&(body.article.page||body.article.sourcePath))throw new CMSFailure('تغییر قالب مقاله فقط برای مدیر مجاز است.',403);
        if (body.head !== head && endpoint === "/publish")
          throw new CMSFailure(
            "نسخه سایت تغییر کرده است. فهرست صفحات را تازه کنید.",
            409,
          );
        const templatePath =
          body.article.locale === "en"
            ? "public/en/blog/how-to-choose-luxury-towels/index.html"
            : "public/blog/rahnamaye-kharid-hole-luxury/index.html";
        const article = articleHTML(
          (await repo.read(templatePath, head)).content,
          body.article,
        );
        const tree = await repo.tree(head);
        if (tree.some((f) => f.path === article.path))
          throw new CMSFailure("مقاله‌ای با این آدرس وجود دارد.");
        ({ path, html } = article);
        assertPageAccess(user,path);if(user.role!=='admin'&&user.contentAccess?.createPages===false)throw new CMSFailure('ساخت صفحه مجاز نیست.',403);
        if (endpoint === "/publish") {
          const indexPath =
            body.article.locale === "en"
              ? "public/en/blog/index.html"
              : "public/blog/index.html";
          const index = await repo.read(indexPath, head);
          changes.push({
            path: indexPath,
            content: addArticleToIndex(index.content, article),
          });
          const sitemap = await repo.read("public/sitemap.xml", head);
          changes.push({
            path: "public/sitemap.xml",
            content: sitemap.content.replace(
              "</urlset>",
              `  <url><loc>${SITE}${article.route}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>`,
            ),
          });
        }
      } else {
        path = pagePath(body.path);
        assertPageAccess(user,path);
        file = await repo.read(path, head);
        if (body.revision !== file.sha)
          throw new CMSFailure(
            "این صفحه بعد از شروع ویرایش تغییر کرده است. پیش‌نویس را دانلود و نسخه جدید را بارگذاری کنید.",
            409,
          );
        if (body.restoreCommit && !/^[a-f0-9]{40}$/.test(body.restoreCommit))
          throw new CMSFailure("نسخه بازگردانی معتبر نیست.");
        const source = body.restoreCommit
          ? await repo.read(path, body.restoreCommit)
          : file;
        await authorizeLegacy(user,repo,head,path,file.content,source.content,body);
        html = applyChanges(
          source.content,
          body.updates || [],
          body.operations || [],
        );
        authorizeLegacyResult(user,path,file.content,html,body.operations||[]);
      }
      const document = describePage(html, path, "preview");
      const tree = await repo.tree(head);
      const existingImages = new Set([
        ...tree.map((f) => f.path),
        ...imageChanges.map((f) => f.path),
      ]);
      for (const field of document.fields.filter((f) => f.kind === "image")) {
        if (!existingImages.has("public" + field.value))
          throw new CMSFailure("یکی از تصاویر در کتابخانه موجود نیست.");
      }
      if (endpoint === "/preview") return json({ html: preview(html, images) });
      if (!cmsPermissions(user).publish)
        throw new CMSFailure(
          "انتشار نهایی به دسترسی مدیر نیاز دارد. می‌توانید پیش‌نویس را دانلود و برای مدیر ارسال کنید.",
          403,
        );
      if (
        !body.article &&
        !body.restoreCommit &&
        !body.updates?.length &&
        !body.operations?.length &&
        !images.length
      )
        throw new CMSFailure("تغییری برای انتشار وجود ندارد.");
      if (!body.article) {
        const sitemap = await repo.read("public/sitemap.xml", head);
        const escaped = (SITE + document.route).replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );
        const updated = sitemap.content.replace(
          new RegExp(`(<loc>${escaped}</loc>\\s*<lastmod>)[^<]+(</lastmod>)`),
          `$1${new Date().toISOString().slice(0, 10)}$2`,
        );
        if (updated !== sitemap.content)
          changes.push({ path: "public/sitemap.xml", content: updated });
      }
      changes.push({ path, content: html }, ...imageChanges);
      const result = await repo.commit(
        head,
        changes,
        `content: update ${path.slice(7)} via CMS (${user.username})`,
      );
      return json({
        ...result,
        path,
        route: document.route,
        message: localMode
          ? "فایل‌ها در پروژه محلی ذخیره شدند. برای انتشار روی سایت، commit و push کنید."
          : "تغییرات در GitHub ثبت شدند. انتشار سایت توسط Cloudflare انجام می‌شود.",
      });
    }
    throw new CMSFailure("درخواست پیدا نشد.", 404);
  } catch (error) {
    return json(
      {
        error:
          error instanceof CMSFailure
            ? error.message
            : "خطای داخلی پنل؛ پیش‌نویس را نگه دارید و دوباره تلاش کنید.",
      },
      error instanceof CMSFailure ? error.status : 500,
    );
  }
}
export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if (url.pathname.startsWith("/api/cms/"))
      return handleCMS(request, env);
    if(['/admin/builder','/admin/builder/','/admin/builder/index.html'].includes(url.pathname)){
      const user=await session(request,env);
      if(!user)return new Response(null,{status:302,headers:{Location:'/admin/?next='+encodeURIComponent('/admin/builder/'+url.search),'Cache-Control':'no-store'}});
      if(!cmsPermissions(user).studio)return new Response('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>دسترسی طراحی</title><p>ابزارهای طراحی فقط برای مدیر مجاز است.</p><a href="/admin/editor/">باز کردن ویرایشگر سایت</a></html>',{status:403,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
    }
    return env.ASSETS.fetch(request);
  },
};
