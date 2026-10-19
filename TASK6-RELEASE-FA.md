# انتشار کنترل‌شدهٔ Builder V2 پس از QA

این راهنما مجوز انتشار نیست. Task 6 فقط تغییر و تست محلی و بررسی فقط‌خواندنی
سرویس‌هاست؛ هیچ Push، merge به main، Deploy یا تغییر محتوای production/secret
در این مرحله انجام نمی‌شود. نتیجه و محدودیت‌ها در `TASK6-QA-FA.md` ثبت می‌شوند.

## checkpointها و فایل‌ها

- شاخه: `codex/professional-freeform-builder`
- production تأییدشده با fetch: `06dc5b37a54916c0d19c14496f677f58bb761ea9`
- checkpoint پیش از QA: `0426684e97b5d113dcc26318ab6d15617e76a18b`
- پشتیبان آن: `.cms-local/task6-baseline/repository.bundle`
- گزارش‌های قبلی preflight: `.cms-local/task6-baseline/prior-preflight/`
- فایل‌های مجاز و فرمان‌ها: `release-candidate.json`
- گزارش‌های خصوصی QA: `.cms-local/task6-qa/` و `.cms-local/task6-blocks-qa/`
- SHA نهایی RC با `git rev-parse HEAD` و در checkpoint خصوصی release ثبت می‌شود.

## اجرای بررسی محلی

```powershell
npm run dev:builder:review
```

پورت ترجیحی نسخهٔ نهایی ۷۹۵۶ است؛ آدرس واقعی چاپ می‌شود:
`http://127.0.0.1:7956/admin/builder/?path=public%2Findex.html`.
سرور روی loopback و کپی تازهٔ `public/` در `.cms-local/builder-review/site-*`
اجرا می‌شود. ثبت صفحه فقط آن کپی را تغییر می‌دهد. نسخهٔ قدیمی ۷۹۵۵ یا کپی‌های
Task 5 با این دستور بازنویسی یا متوقف نمی‌شوند.

## پیش از انتشار آنلاین بعدی — بررسی دوباره

```powershell
git status --short
git fetch origin main
npm test
npm run test:builder:migration
npm run test:builder:blocks
npm run test:builder:pages
npm run test:builder:media
npm run test:builder:pro
npm run test:builder
npm run test:builder:publish
npm run test:browser
npm run test:release:browser
npm run test:release:runtime
node test/cms-runtime.mjs
node scripts/release-preflight.mjs --verify-remote
npm run release:prepare
git diff --check
```

اگر HEAD یا محتوای production بعد از این QA تغییر کرد، تغییرات تازه را ابتدا
در شاخهٔ release بدون overwrite تلفیق و تست کنید؛ main را reset نکنید. نوشتن
توکن GitHub فقط با canary مجاز اثبات می‌شود؛ نقش push حساب و خواندن مخزن به‌تنهایی
scope دقیق fine-grained token را ثابت نمی‌کند. مقدار secretهای آنلاین خواندنی
نیست؛ فقط وجود نام bindingها بررسی می‌شود و تطبیق مقدار ادعا نمی‌شود.

خروج صفر preflight به‌تنهایی معیار مجوز انتشار نیست؛ همهٔ نتیجه‌های local و
دسترسی‌های لازم GitHub/Cloudflare باید در گزارش موفق باشند. در نبود مرجع معتبر
single-version، شکست دسترسی یا استقرار چندنسخه‌ای، انتشار/rollback را متوقف و
مرجع مناسب را بررسی کنید. گزارش قدیمی را جای نتیجهٔ اجرای تازه استفاده نکنید.

## انتشار واقعی — فقط پس از مجوز مستقل

1. HEAD دقیق main و نسخهٔ فعال Worker را بلافاصله پیش از انتشار ثبت کنید:
   `node scripts/release-preflight.mjs --verify-remote`.
   فایل خصوصی `.cms-local/preflight/references.json` را به
   `.cms-local/task6-release/references-before-online.json` کپی کنید. از مرجع قدیمی
   قبل از چرخش secret استفاده نکنید.
2. commit تأییدشدهٔ RC را به شاخهٔ release بفرستید، diff را بازبینی و از روند
   بازبینی مخزن به main تلفیق کنید؛ تغییرات محتوایی هم‌زمان باید حفظ شوند.
   Push و merge هر دو اقدام آنلاین و خارج از مجوز Task 6 هستند.
3. Worker و کل `public/` باید یک نسخه باشند. از checkout دقیق کد تأییدشده:

```powershell
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir .wrangler/dry-run
node node_modules/wrangler/bin/wrangler.js deploy --name baran-towel-site --keep-vars --message 'Controlled Builder V2 release'
```

فرمان دوم انتشار واقعی است. اگر Git integration همین commit را قبلاً منتشر
کرده، ابتدا version/commit واقعی را تطبیق دهید و انتشار تکراری انجام ندهید.
موفقیت commit یا generic build check تأیید استقرار production نیست.

4. ورود تازهٔ admin، منع anonymous/editor برای ثبت، `/admin/builder/` و ۹ صفحه
   را بررسی کنید. JSON پیش‌نویس‌های واقعی را قبل از مهاجرت دانلود کنید. یک صفحهٔ
   canary با slug یکتا، حالت unlisted/noindex و بدون منو بسازید؛ تصویر، بلوک‌ها،
   CSS و تعاملات را در ۱۴۴۰/۱۲۸۰/۷۶۸/۳۹۰/۳۲۰ مستقل از editor بخوانید.
5. receipt/CAS، Worker version و خروجی عمومی را ثبت کنید. canary را حذف کنید و
   نبود مسیر، sitemap و لینک باقی‌مانده را بررسی کنید؛ asset محتوامحور را عجولانه
   حذف نکنید. دادهٔ آرشیو خصوصی نباید به `public/` منتقل شود.

## بازگشت آنلاین — پس از مجوز rollback

برای یک canary مستقل، داده را با API/ویرایشگر روی revision تازه یا commit معکوس
برگردانید؛ اگر کار دیگری هم‌زمان ثبت شده، کل فایل را کورکورانه overwrite نکنید.
در rollback کامل، محتوای v2 و تغییرات وابستهٔ منو، registry، sitemap و redirectها
را با commit معکوس از snapshot پیش از انتشار بازگردانید. سپس Worker و assets:

```powershell
$builderRollback = Get-Content -Raw -LiteralPath '.cms-local/task6-release/references-before-online.json' | ConvertFrom-Json
if ($builderRollback.workerVersion -notmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$') { throw 'No verified single-version rollback reference; stop and inspect deployments.' }
node node_modules/wrangler/bin/wrangler.js rollback $builderRollback.workerVersion --name baran-towel-site --message 'Controlled Builder V2 rollback'
```

این فرمان فوری و آنلاین است. نسخهٔ برگشتی باید پس از آخرین چرخش secret باشد؛
در صورت تغییر secret بعد از snapshot، rollback کد با secret فعلی لازم است.
روند build در حال اجرا را بررسی کنید تا نسخهٔ مشکل‌دار دوباره فعال نشود. مخزن را
با revert بازبینی‌شده هماهنگ و ورود، تمام ۹ صفحه، تصاویر، SEO و API را smoke کنید.
از force-push، reset مخرب و انتخاب `-m` برای merge بدون بررسی graph استفاده نکنید.

## بازگشت صرفاً محلی

```powershell
git bundle verify .cms-local/task6-baseline/repository.bundle
git worktree add --detach .cms-local/task6-before-qa 0426684e97b5d113dcc26318ab6d15617e76a18b
```

شاخهٔ فعلی، کپی‌های review و JSONها را نگه دارید. checkout قدیمی را روی origin
جدا اجرا کنید. بازگشت به قبل از کل V2 از bundle Task 5 و baseline تولیدی بالاست؛
ویرایشگر v1 برای بازکردن draft v2 مناسب نیست. هیچ حذف backup یا reset لازم نیست.
