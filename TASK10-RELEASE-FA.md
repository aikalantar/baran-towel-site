# Task 10 — کاندیدای محلی انتشار و بازگشت

وضعیت: پیاده‌سازی و QA محلی موفق؛ **Push، merge و Deploy در Task 10 مجاز نیست و انجام نشده است**. هیچ استخراج CMS_CORE در این تغییر وجود ندارد. برای انتشار آنلاین، دستور جداگانهٔ مالک لازم است.

پایهٔ production و شاخه: `61425167403f7db2ebd019913d03201a860b3740` → `codex/task10-cms-stabilization`. SHA نهایی کاندیدا همان commit محلی نهایی این شاخه است؛ با `git rev-parse HEAD` خوانده شود. گزارش QA: `TASK10-QA-FA.md`.

## دامنهٔ نسخه

اصلاح لینک‌های ارث‌رسیده در ساخت صفحه، تأیید محتاطانهٔ deployment، پیام و پایش وضعیت انتشار، و حفاظت از پیش‌نویس در Builder و CMS قدیمی. مدل V1/V2، هر ۱۶ بلوک، Free/Flow، دو حالت ویرایش، API مجوز انتشار، CAS، محدودیت مسیر و CSP حفظ می‌شوند. فایل مشتری یا secret در commit وجود ندارد.

Worker و assets باید از **یک Git tree** منتشر شوند: تغییرهای `src/pages.js`، `src/github.js` و ماژول تازهٔ `src/deployment.js` همراه با `public/admin/admin.js`، `public/admin/builder/builder.js` و فایل‌های تازهٔ `public/admin/draft-safety.js`، `public/admin/draft-recovery.css` و `public/admin/builder/publication-status.js`. تغییر تنظیمات assets، binding یا زیرساخت لازم نیست. انتشار فقط بخش Worker یا فقط assets مجاز نیست.

## تنظیم اختیاری شواهد مستقیم Cloudflare

هیچ credential یا تنظیم production در این task اضافه نشده است. بدون تنظیم مستقیم نیز trusted GitHub Deployments در صورت وجود استفاده می‌شود و در نبود شواهد، UI دقیقاً عدم امکان تأیید را بیان می‌کند. check موفق build به‌تنهایی اثبات فعال‌شدن نسخه نیست.

برای فعال‌کردن مسیر مستقیم در انتشار مجاز آینده، فقط در محیط سمت سرور Worker تنظیم شوند:

- `CMS_CF_ACCOUNT_ID`: حساب همان Worker.
- `CMS_CF_WORKER_NAME`: نام Worker متصل به دامنهٔ production، فعلاً `baran-towel-site`.
- `CMS_CF_API_TOKEN`: secret سمت سرور؛ هرگز در public، JSON مرورگر، Git یا خروجی گزارش قرار نگیرد.

کد فقط GET به API ثابت Cloudflare می‌فرستد، redirect را دنبال نمی‌کند و پاسخ فاقد مجوز را unknown برمی‌گرداند. token باید دسترسی لازم برای خواندن domain، deployment و ارتباط build/version در همان حساب را داشته باشد. طبق [مرجع Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)، Builds API می‌تواند user-scoped token و مجوز `Workers Builds Configuration: Edit` بخواهد؛ بنابراین این token را «فقط‌خواندنی از نظر scope» فرض نکنید. ایجاد token یا افزایش مجوز در این task انجام نشده است. اگر چنین دسترسی‌ای مطلوب/موجود نیست، وضعیت تأییدنشده و راهنمای UI رفتار صحیح است. [مرجع build مربوط به version](https://developers.cloudflare.com/api/resources/workers_builds/methods/get_builds_by_version/) مبنای تطبیق مستقیم است.

موفقیت مستقیم مستلزم دامنهٔ `luxtowelco.com` در محیط production همان Worker، تنها یک version با ترافیک ۱۰۰٪، build موفق غیر-PR از GitHub با مخزن `aikalantar/baran-towel-site`، شاخهٔ main و SHA دقیق درخواست‌شده است. deployment و HEAD پیش از نتیجه‌دادن دوباره خوانده می‌شوند. اطلاعات خام provider و token به مشتری بازگردانده نمی‌شوند.

## اجرای مجاز آینده

۱. پیش از انتشار، main، وضعیت کاری، diff کامل کاندیدا، deployment فعال، buildهای در جریان، secret/bindingها و تغییرهای محتوا را دوباره فقط بخوانید. مرجع این گزارش snapshot است؛ اگر محتوا/secret یا main تغییر کرده، کاندیدا را بدون بازنویسی تغییرهای هم‌زمان تازه‌سازی و دوباره آزمون کنید. bundle و snapshot خصوصی تازه بگیرید و پیش‌نویس موجود مدیر را بدون ویرایش محتوا export کنید.

۲. دستورهای QA زیر و preflight را روی tree نهایی اجرا کنید. شواهد را خصوصی نگه دارید؛ تست provider ایزوله را به‌عنوان موفقیت آنلاین گزارش نکنید.

```powershell
npm test
npm run test:stabilization:browser
npm run test:builder:ux
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
npm run test:performance:local
node scripts/release-preflight.mjs --verify-remote
```

۳. پس از مجوز انتشار، push معمول شاخه و ادغام ایمن با main تازه انجام دهید؛ force-push، reset main یا جایگزینی محتوای مشتری ممنوع است. اگر تغییر هم‌زمان هست، آن را حفظ و merge/rebase کاندیدا را دوباره تست کنید. SHA tree منتشرشونده باید معلوم و آزموده باشد. فقط Git integration موجود Cloudflare را به کار ببرید؛ `wrangler deploy` دستی موازی اجرا نکنید.

۴. نتیجهٔ build، نسخهٔ واقعاً فعال، دامنهٔ متصل و بایت‌های assets زنده را با SHA ادغام تطبیق دهید. API/Worker و هر چهار asset تازه باید قابل دسترس باشند. سپس ورود واقعی مدیر، حالت ساده برای profile تازه، inspector متن/تصویر، پیشرفته، responsive، حفظ draft هنگام تغییر حالت/refresh، CMS قدیمی و نه صفحهٔ اصلی را مستقل بررسی کنید. اگر token مستقیم تنظیم شده، تأیید API واقعی provider ضروری است؛ در غیر این صورت unknown همراه راهنمای صادقانه قابل انتظار است.

۵. هر آزمون انتشار تغییردهندهٔ آنلاین فقط در صورت مجوز همان مرحله و روی صفحهٔ موقت noindex/unlisted انجام شود؛ صفحه و sitemap/navigation پس از پاک‌سازی بررسی شوند. هیچ محتوای موجود مشتری برای تست تغییر نکند. بدون این مجوز، آزمون‌های آنلاین غیرتغییردهنده انجام دهید و محدودیت پوشش را بنویسید.

## مرجع بازگشت

مرجع سالم فعلی: Git `61425167403f7db2ebd019913d03201a860b3740`؛ Worker `8100701b-f82b-419f-9317-dac80bd9ab64`، تک‌نسخه ۱۰۰٪، در preflight Task 10 دوباره خوانده شد. bundle کامل و معتبر قبل از تغییر در `.cms-local/task10-qa/repository-before.bundle` است. گزارش‌ها و backupهای Task 9 محفوظ‌اند. هیچ rollback در Task 10 اجرا نشد.

روش ترجیحی پس از انتشار، revert معمول **فقط commitهای Task 10** از main تازه و انتشار آن tree از همان Git integration است. محتوا، secrets، branch history یا IndexedDB را پاک نکنید. به‌ویژه پیش‌نویس تماس و JSON بازیابی را نگه دارید؛ کلیدهای Builder و CMS قبلی تغییری ندارند و downgrade نیازی به پاک‌سازی مرورگر ندارد.

برای خرابی بحرانی فوری، فقط پس از خواندن دوبارهٔ deploymentها و اثبات اینکه نسخهٔ مرجع هنوز با محتوای مشتری و secrets فعلی سازگار است، بازگشت نسخهٔ Worker مجاز خواهد بود. اگر پس از مرجع، محتوای مشتری عوض شده، فعال‌کردن assets قدیمی امن نیست؛ از revert محدود روی main تازه استفاده کنید. buildهای در جریان نباید دوباره نسخهٔ خراب را فعال کنند.

دستور زیر صرفاً مرجع عملیات **آیندهٔ مجاز** است و اکنون اجرا نشده:

```powershell
node node_modules/wrangler/bin/wrangler.js rollback 8100701b-f82b-419f-9317-dac80bd9ab64 --name baran-towel-site --message 'Rollback Task 10 CMS stabilization after verified critical regression'
```

پس از rollback اضطراری، GitHub را با revert معمول هماهنگ کنید؛ نسخهٔ فعال، تطبیق Worker/assets، ورود، CMS، پیش‌نویس‌ها، نه صفحه و sitemap را مجدداً بررسی کنید. secretها را برنگردانید یا نچرخانید و فایل مشتری را با snapshot قدیمی جایگزین نکنید.
