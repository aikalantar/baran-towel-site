# بستهٔ بررسی صفحه‌ساز حرفه‌ای — Task 5

این بسته فقط محلی است. هیچ Push، Deploy، تغییر secret یا محتوای production
در Task 5 انجام نشده است. کد CMS، Worker، مجوزها و انتشار قبلی توسعه داده شده‌اند؛
وابستگی جدید، پایگاه داده یا سرویس خارجی اضافه نشده است.

## مبنا و فایل‌های قابل بررسی

- شاخه: `codex/professional-freeform-builder`
- مبنای تأییدشده: `06dc5b37a54916c0d19c14496f677f58bb761ea9`
- پشتیبان کامل Git: `.cms-local/task5-baseline/repository.bundle`
- نسخه‌های اصلی مدل/renderer/کلاینت: `.cms-local/task5-baseline/`
- فهرست دقیق فایل‌ها و فرمان‌های QA: `release-candidate.json`
- قرارداد داده: `BUILDER-SCHEMA-V2.md`؛ راهنمای کاربر: `BUILDER-GUIDE-FA.md`
- گزارش‌های خصوصی و تصاویر QA: `.cms-local/task5-qa/` و `.cms-local/preflight/`

`npm run release:prepare` فقط manifest را می‌خواند، فایل‌ها را با secretهای محلی
در حافظه مقایسه و مسیرهای خصوصی/فایل‌های اصلی محافظت‌شده را کنترل می‌کند.
گزینهٔ `--stage` فقط فایل‌های همان manifest را stage می‌کند. این دستور فایل
manifest را بازنویسی نمی‌کند و هرگز push یا deploy انجام نمی‌دهد.

## بررسی محلی ایزوله

```powershell
npm run dev:builder:review
```

آدرس ترجیحی: `http://127.0.0.1:7955/admin/builder/?path=public%2Findex.html`.
آدرس واقعی و محل کپی در خروجی چاپ می‌شود. انتشار در این کپی، HTML/CSS/تصویر،
منو، registry و sitemap واقعی ایجاد می‌کند، بدون تغییر `public/` پروژه.
پیش‌نویس IndexedDB به origin مرورگر وابسته است؛ هنگام تعویض پورت، JSON را برای
انتقال دانلود کنید. آرشیو محلی و نسخه‌های انتشار داخل همان کپی می‌مانند.

## چک‌های لازم پیش از انتشار آنلاین بعدی

```powershell
npm test
npm run test:builder
npm run test:builder:publish
npm run test:builder:pro
npm run test:browser
npm run test:release:browser
npm run test:release:runtime
node test/cms-runtime.mjs
npm run release:preflight
npm run release:prepare
git diff --check
```

`deploy:check` در تست runtime فقط `wrangler deploy --dry-run` است. GitHub و
provider داخل تست‌ها شبیه‌سازی می‌شوند؛ canary واقعی آنلاین در این بسته نیست.
موفقیت این تست‌ها ادعای تأیید کامل WCAG یا Core Web Vitals نیست.

## محدودیت‌های روشن

P0: مدل v2، صفحات واقعی، ۱۶ بلوک، Free/Flow، گروه سازگار، Inspector، سه
breakpoint، تاریخچه و خروجی static آمادهٔ بررسی‌اند. گروه‌بندی ساختار اصلی یا
عنصر دارای ابعاد px/vw/vh رد می‌شود؛ نسخهٔ تازه و تبدیل ابعاد به درصد راه‌حل است.
آرشیو/حذف/slug عملیات تاریخچهٔ انتشارند؛ Undo محلی فقط پیش‌نویس را برمی‌گرداند.
صفحهٔ unlisted خصوصی نیست. حذف صفحهٔ دارای لینک ورودی مسدود می‌شود؛ ابتدا
لینک‌ها را اصلاح کنید. slug فقط پس از پذیرش صریح بازنویسی لینک‌ها تغییر می‌کند.

P1 ناقص: دستیار جامع تشخیص/پیشنهاد/اعمال و بلوک ویدئو باقی‌اند. هشدارهای سادهٔ
خوانایی/خروج از کادر/هم‌پوشانی که هیچ طرحی را خودکار تغییر نمی‌دهند،
جست‌وجوی تصویر، focal point، نسبت کادر، نشان ذخیره، تأیید تخریب و وضعیت مبتنی
بر شواهد provider موجودند. crop فایل، همگام‌سازی چنددستگاهی، فرم واقعی و commerce
وجود ندارند. نامعلوم‌بودن استقرار با موفقیت commit جایگزین نمی‌شود.

## بازگشت محلی بدون حذف کار

1. JSON پیش‌نویس‌های v2 را دانلود و کپی review را حفظ کنید؛ v1 قادر به خواندن
   همهٔ داده‌های v2 نیست. نسخهٔ خام مهاجرت‌یافتهٔ v1 جداگانه در IndexedDB حفظ است.
2. checkpoint شاخه و bundle را نگه دارید. اعتبار bundle را بررسی کنید:
   `git bundle verify .cms-local/task5-baseline/repository.bundle`.
3. برای اجرای کد قبلی، checkout مستقل بسازید؛ شاخهٔ فعلی را reset نکنید:
   `git worktree add --detach .cms-local/task5-baseline-review 06dc5b37a54916c0d19c14496f677f58bb761ea9`.
4. نسخهٔ قدیمی را با origin/پورت جدا اجرا کنید. پوشهٔ review فعلی، snapshotها و
   فایل‌های پروژه را روی آن کپی نکنید. هیچ `reset --hard` یا `clean` لازم نیست.

## انتشار و بازگشت آنلاین — فقط با دستور مستقل بعدی کاربر

قبل از هر انتشار، HEAD واقعی GitHub، محتوای جاری و Worker version فعلی را دوباره
ثبت کنید؛ مقدار مبنای بالا جایگزین بررسی تازه نیست. تغییرات محتوایی جدید را
بدون بازنویسی با شاخهٔ release تلفیق و تست کنید. Worker و تمام دارایی‌های `public/`
باید در یک release منتشر شوند؛ فقط تغییر client کافی نیست. ابتدا نسخهٔ قابل
بازگشت provider و snapshot فایل‌های درگیر canary را ثبت کنید.

پس از مجوز مستقل: release قابل بررسی را طبق روش موجود مخزن منتشر کنید، ورود
تازه، منع editor، مسیر `/admin/builder/` و نُه صفحه را بررسی کنید؛ یک صفحهٔ
canary با slug یکتا بسازید و خروجی static، تصویر، SEO و چهار عرض را مستقل بخوانید.
پاسخ commit موفق به‌تنهایی موفقیت Cloudflare نیست؛ وضعیت provider یا پاسخ واقعی
سایت با نسخهٔ دقیق باید ثبت شود. سپس canary و تمام تغییرات وابستهٔ منو/sitemap/
registry را با commit برگشتی و CAS برگردانید و نبود مسیر canary را تأیید کنید.

اگر rollback کامل لازم شد، ابتدا محتوای v2 آن release را با commit معکوس از
snapshot پیش از canary بازگردانید؛ سپس Worker و asset version ثبت‌شدهٔ قبل از
انتشار را با rollback provider برگردانید. همهٔ صفحات، API نشست، canonical،
تصاویر و ورود تازه را دوباره بررسی کنید. تاریخچه را force-push یا reset نکنید.
secretها در Task 5 تغییری ندارند و rollback آن‌ها جزو این مسیر نیست.
