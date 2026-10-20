import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startLocal } from "../scripts/cms-local.mjs";

const exec = promisify(execFile);
const workspace = path.resolve(".cms-local");
await fs.mkdir(workspace, { recursive: true });
const sandbox = await fs.mkdtemp(path.join(workspace, "browser-"));
await fs.cp("public", path.join(sandbox, "public"), { recursive: true });
await exec("git", ["init", "-q"], { cwd: sandbox });
await exec("git", ["config", "user.name", "CMS Test"], { cwd: sandbox });
await exec("git", ["config", "user.email", "cms-test@example.invalid"], {
  cwd: sandbox,
});
await exec("git", ["add", "public"], { cwd: sandbox });
await exec("git", ["commit", "-qm", "Test fixture"], { cwd: sandbox });
const server = await startLocal(sandbox, 0);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let count = 0;
try {
  await page.goto(origin + "/admin/");
  await page
    .getByRole("heading", { name: "اینجا، باران را به‌روز نگه دارید." })
    .waitFor();
  await page.screenshot({
    path: path.join(workspace, "cms-dashboard.png"),
    fullPage: true,
  });
  count++;
  await page.locator('[data-open="public/index.html"]').first().click();
  await page
    .getByLabel("عنوان اصلی", { exact: true })
    .fill("عنوان آزمایشی باران");
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("heading", { name: "اینجا، باران را به‌روز نگه دارید." })
    .waitFor();
  await page.locator('[data-open="public/index.html"]').first().click();
  assert.equal(
    await page.getByLabel("عنوان اصلی", { exact: true }).inputValue(),
    "عنوان آزمایشی باران",
  );
  count++;
  await page.getByRole("button", { name: "به‌روزرسانی پیش‌نمایش" }).click();
  await page
    .frameLocator("#preview")
    .getByRole("heading", { name: "عنوان آزمایشی باران" })
    .waitFor();
  await page.screenshot({
    path: path.join(workspace, "cms-editor.png"),
    fullPage: true,
  });
  count++;
  await page
    .getByRole("button", { name: "ذخیره در پروژه", exact: true })
    .click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/cms/publish") && r.status() === 200,
    ),
    page.locator("[data-dialog-yes]").click(),
  ]);
  await page
    .getByText("فایل‌ها در پروژه محلی ذخیره شدند.", { exact: false })
    .waitFor();
  assert.ok(
    (
      await fs.readFile(path.join(sandbox, "public/index.html"), "utf8")
    ).includes("عنوان آزمایشی باران"),
  );
  count++;
  await page
    .getByRole("button", { name: /تصاویر/ })
    .filter({ has: page.locator("span") })
    .first()
    .click();
  await page.locator("[data-pick]").first().click();
  await page
    .locator('[data-select-image="public/assets/products/mozhan.webp"]')
    .click();
  await page.locator("[data-alt]").first().fill("عکس آزمایشی موژان");
  await page.getByRole("button", { name: "به‌روزرسانی پیش‌نمایش" }).click();
  await page
    .frameLocator("#preview")
    .getByAltText("عکس آزمایشی موژان")
    .waitFor();
  count++;
  await page.locator("[data-pick]").first().click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("[data-dialog-upload]").click(),
  ]);
  await chooser.setFiles("public/assets/products/mozhan.webp");
  await page.waitForFunction(() =>
    document
      .querySelector(".image-edit-head img")
      ?.src.startsWith("data:image/webp;base64,"),
  );
  await page.getByRole("button", { name: "به‌روزرسانی پیش‌نمایش" }).click();
  await page
    .frameLocator("#preview")
    .locator('img[src^="data:image/webp"]')
    .first()
    .waitFor();
  count++;
  await page.locator('[data-nav="catalog"]').click();
  await page.locator('[data-tab="models"]').click();
  await page.locator('[data-model-copy="sanam"]').click();
  await page
    .getByLabel("نام مدل جدید", { exact: true })
    .fill("مدل مخصوص آزمایش");
  await page
    .getByLabel("شناسه کوتاه انگلیسی", { exact: true })
    .fill("browser-test-model");
  await page.getByLabel("مشخصه: رنگ", { exact: true }).fill("آبی");
  await page
    .getByRole("button", { name: "افزودن به پیش‌نویس", exact: true })
    .click();
  await page.getByRole("button", { name: "به‌روزرسانی پیش‌نمایش" }).click();
  await page
    .frameLocator("#preview")
    .getByRole("heading", { name: "مدل مخصوص آزمایش", exact: true })
    .waitFor();
  count++;
  await page.locator('[data-nav="blog"]').click();
  await page.getByRole("button", { name: "مقاله جدید" }).click();
  await page
    .getByLabel("عنوان مقاله", { exact: true })
    .fill("راهنمای آزمایشی نگهداری");
  await page.getByLabel("آدرس کوتاه انگلیسی").fill("browser-test-article");
  await page
    .getByLabel("توضیح کوتاه برای معرفی و Google")
    .fill("توضیح مقاله آزمایشی");
  await page
    .getByLabel("متن مقاله", { exact: true })
    .fill("## نگهداری حوله\n\nیک متن آزمایشی فارسی.");
  await page
    .getByRole("button", { name: "نمایش نتیجه", exact: true })
    .first()
    .click();
  await page
    .frameLocator("#preview")
    .getByRole("heading", { name: "راهنمای آزمایشی نگهداری", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "ذخیره در پروژه", exact: true })
    .click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/cms/publish") && r.status() === 200,
    ),
    page.locator("[data-dialog-yes]").click(),
  ]);
  await page
    .getByText("فایل‌ها در پروژه محلی ذخیره شدند.", { exact: false })
    .waitFor();
  assert.ok(
    (
      await fs.readFile(path.join(sandbox, "public/blog/index.html"), "utf8")
    ).includes("/blog/browser-test-article/"),
  );
  assert.ok(
    (
      await fs.readFile(path.join(sandbox, "public/sitemap.xml"), "utf8")
    ).includes("/blog/browser-test-article/"),
  );
  count++;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#cms-menu-toggle').click();
  await page.locator('[data-nav="home"]').click();
  await page
    .getByRole("heading", { name: "اینجا، باران را به‌روز نگه دارید." })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({
    path: path.join(workspace, "cms-mobile.png"),
    fullPage: true,
  });
  count++;
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: count,
      browserErrors: errors,
      screenshots: workspace,
      sandbox,
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
