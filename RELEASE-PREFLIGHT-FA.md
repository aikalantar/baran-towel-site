# پیش‌پرواز انتشار کنترل‌شده Visual Builder

این راهنما مجوز اجرا نیست. در اجرای preflight هیچ Push، Deploy، تغییر محتوای
production یا تغییر Secret آنلاین انجام نشده است. شاخه آماده بازبینی:
`codex/visual-builder-release`؛ فایل‌های مجاز در `release-candidate.json` مشخص‌اند.

## نتیجه و دامنه تأیید

کد برای نخستین آزمایش آنلاین کنترل‌شده آماده است. انتشار واقعی production
هنوز آزمایش نشده؛ اثبات مجوز Contents write توکن GitHub نیازمند Canary مجاز است.
نقش نوشتن حساب، اعتبار توکن و دسترسی فقط‌خواندنی مخزن/شاخه بررسی شده‌اند؛ این
موارد به‌تنهایی اثبات سطح دقیق permission یک fine-grained token نیستند.

پیش‌پرواز نقش‌های admin/editor، نشست امضاشده، CSRF، safe path، revision/CAS،
HTML متنی و CSS محدود، تصاویر و شواهد استقرار را بررسی می‌کند. نام مشابه
Cloudflare، generic build check، commit ناموجود، نسخه قدیمی شاخه یا وضعیت
ساخته‌شده توسط کاربر، موفقیت استقرار تلقی نمی‌شوند.

فایل‌های واقعی `.cms-local/secrets.json` و `.dev.vars` فقط در حافظه خوانده و با
redactor آزمایش شده‌اند. exportها credentialهای بدون برچسب، مقدار اصلی، شکل
JSON-escaped و URL-encoded را نیز حذف می‌کنند. گزارش‌ها فقط نتیجه بررسی را
ثبت می‌کنند. secretهای production از Cloudflare خواندنی نیستند؛ فقط وجود نام
bindingها بررسی شده است و تطبیق مقدار محلی/آنلاین ادعا نمی‌شود.

## مرور و تکرار بررسی‌ها — محلی و مجاز

از ریشه پروژه:

```powershell
git branch --show-current
git diff --cached --stat
git diff --cached --check
npm test
npm run test:builder
npm run test:builder:publish
npm run test:browser
npm run test:release:browser
npm run test:release:runtime
node test/cms-runtime.mjs
node scripts/release-preflight.mjs
```

`test:release:runtime` فقط `wrangler deploy --dry-run` را برای bundling و assets
اجرا می‌کند، سپس workerd با همان Worker و Static Assets و GitHub شبیه‌سازی‌شده
را بررسی می‌کند. هیچ ارتباط خارجی در تست انتشار runtime وجود ندارد. تست
Canary و rollback آن در محیط ایزوله است؛ فایل صفحات واقعی پروژه تغییر نمی‌کند.

بررسی آنلاین فقط‌خواندنی:

```powershell
node scripts/release-preflight.mjs --verify-remote
```

مقادیر را از فایل Secret به ترمینال نریزید. فایل‌های امن محلی این اجرا:

- `.cms-local/preflight/environment-report.json`: نتیجه محیط و دسترسی‌ها.
- `.cms-local/preflight/staging-report.json`: نتیجه scan فایل‌های Stage‌شده.
- `.cms-local/preflight/references.json`: مرجع GitHub و Worker قبلی برای rollback؛
  عمومی‌کردن یا commit کردن آن لازم نیست.
- `.cms-local/preflight/online-home-before.html`: نسخه فقط‌خواندنی صفحه آنلاین.
- `.cms-local/preflight/site-browser-report.json`: گزارش responsive عمومی سایت.
- `.cms-local/preflight/redaction-canary.json`: خروجی پاک‌سازی‌شده آزمون؛ داده خام نیست.

اجرای محلی Builder: `http://127.0.0.1:7950/admin/builder/`.

## ۱. دروازه مجوز برای انتشار

قبل از هر اقدام آنلاین نوشتنی، مجوز صریح برای همگام‌سازی کد GitHub، استقرار
کنترل‌شده، Canary و rollback لازم است. این مرحله در preflight اجرا نشده است.
روی branch آماده، diff کامل Stage‌شده را مرور کنید؛ `.cms-local`، `.dev.vars`،
فایل‌های snapshot، log، profile مرورگر و اطلاعات حساس نباید در index باشند.

در لحظه اقدام، بررسی فقط‌خواندنی را دوباره اجرا کنید تا نسخه Worker و GitHub
مبنای rollback تازه باشد. از JSON نسخه قبلی خارج از Git یک کپی با نام محلی
تاریخ‌دار نگه دارید؛ اجرای بررسی آنلاین جدید مراجع همان لحظه را تازه می‌کند.

## ۲. انتشار کد — فقط پس از مجوز

روش ترجیحی، همان روند GitHub/Cloudflare موجود است:

```powershell
git commit -m "feat: release visual builder with guarded publishing"
git push origin codex/visual-builder-release
```

سپس PR همین branch را از روند معمول بازبینی و merge به `main` منتشر کنید.
Push و merge نیاز به همان مجوز آنلاین دارند؛ هیچ force push مجاز نیست.
فقط نسخه‌ای را deploy کنید که کد Worker و تمام assets همین RC را دارد.

ضروری: پیش از Canary باید همین کد در `main` مخزن متصل باشد. Deploy مستقیم از
پوشه محلی بدون همگام‌سازی GitHub کافی نیست: انتشار محتوای Builder یک commit
جدید در `main` می‌سازد و build بعدی می‌تواند کد قدیمی مخزن را دوباره مستقر کند.

اگر build متصل خودکار انجام می‌شود، deploy موازی دستی اجرا نکنید. fallback
زیر فقط با مجوز، پس از تطبیق کد main با همین RC و نبود build در حال اجراست:

```powershell
node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.jsonc
```

`wrangler.jsonc` هم Worker (`src/cms-worker.js`) و هم کل `public/`، از جمله
`public/builder-layout.js` و ماژول‌های `/admin/builder/` را در یک نسخه قرار می‌دهد.
در این RC migration یا storage schema جدیدی برای Durable Object اضافه نشده است.

## ۳. Smoke آنلاین و Canary — فقط پس از مجوز

۱. وجود `/admin/` و `/admin/builder/`، CSS/JSهای لازم و runtime عمومی را بررسی کنید.
۲. کاربر ناشناس باید داده Builder را با 401 ببیند؛ editor می‌تواند پیش‌نویس بسازد
   اما publish باید 403 بدهد. این تست‌ها در preflight با حساب‌های fixture انجام شده‌اند؛
   حساب یا Secret جدیدی در production ساخته نشده است.
۳. با admin وارد شوید، صفحه اصلی را باز کنید و JSON پیش‌نویس اصلی را دانلود کنید.
۴. متن اصلی و revision همین لحظه را خصوصی نگه دارید. تغییر نمونه آماده در
   `test/fixtures/release-canary.json` فقط یک suffix در پاراگراف intro اضافه می‌کند؛
   عنوان SEO، canonical، تصویر و ساختار صفحه را تغییر نمی‌دهد.
۵. پیش‌نمایش ۱۲۸۰ و ۳۹۰ را بررسی و فقط یک بار ثبت کنید. قبل از ثبت، نام صفحه
   و متن دقیق تغییر باید در پنل قابل مرور باشد.
۶. commit مربوط به همین عملیات، فایل‌ها، تصاویر و وضعیت واقعی Cloudflare را
   بررسی کنید. commit موفق به معنی deploy موفق نیست. در صورت «قابل تأیید نیست»،
   Dashboard/build مرتبط با همان commit را بررسی کنید و موفقیت فرض نکنید.
۷. صفحه عمومی، canonical/hreflang/schema، srcset، تصویر LCP و رفتار منو/کاتالوگ
   را در موبایل و دسکتاپ بررسی کنید؛ سپس Canary را برگردانید.

## ۴. rollback محتوا

برای Canary متنی، پس از تازه‌کردن صفحه Builder، متن ذخیره‌شده قبل از آزمون را
برگردانید و روی revision جدید ثبت کنید. اگر تغییر دیگری هم‌زمان اتفاق افتاده،
ابتدا آن را بررسی کنید؛ از بازگردانی کورِ کل صفحه استفاده نکنید.

اگر Canary یک commit مستقل است و revert آن با کار دیگر تداخل ندارد، جایگزین
زیر یک commit جدید می‌سازد و تاریخچه را نگه می‌دارد:

```powershell
git revert <CANARY_COMMIT>
git push origin main
```

این Push هم آنلاین است و فقط با مجوز انجام می‌شود. از reset، clean، force push
یا بازنویسی تغییرات هم‌زمان استفاده نکنید. assets محتوامحورِ بلااستفاده فوراً
حذف نمی‌شوند تا ارجاع نسخه‌های قبلی سالم بماند.

## ۵. rollback اضطراری کد و assets

ابتدا اجازه rollback و وضعیت buildهای در حال اجرا را بررسی کنید تا build جدید
بلافاصله نسخه مشکل‌دار را برنگرداند. مرجع پیش از انتشار در فایل محلی ثبت شده:

```powershell
$releaseBaseline = Get-Content -Raw -LiteralPath '.cms-local/preflight/references.json' | ConvertFrom-Json
node node_modules/wrangler/bin/wrangler.js rollback $releaseBaseline.workerVersion --name baran-towel-site --message 'Controlled Builder release rollback'
```

این دستور فوراً یک deployment آنلاین ایجاد می‌کند و در این preflight اجرا نشده
است. نسخه Worker شامل کد، static assets و تنظیمات binding است. پس از rollback،
رابط قدیمی، صفحات عمومی و نشست را smoke کنید. سپس کد مخزن را با revert commit
انتشار، از روند بازبینی موجود هماهنگ کنید تا build بعدی دوباره RC مشکل‌دار را
منتشر نکند. برای revert یک merge commit باید mainline صحیح آن تعیین شود؛
گزینه `-m` را بدون بررسی graph انتخاب نکنید.

اگر Secret بعد از baseline چرخانده شده، این نسخه قدیمی ممکن است کلید قدیمی
داشته باشد. در رخداد امنیتی، به نسخه‌ای که کلید لو‌رفته را دوباره فعال می‌کند
rollback نکنید؛ از rollback کد با Secret جدید یا baseline پس از rotation استفاده کنید.

## ۶. چرخش امن CMS_SESSION_SECRET — اقدام جداگانه و نیازمند مجوز

در این اجرا هیچ کلید production عوض نشده است. چرخش کلید همه نشست‌های فعلی
را نامعتبر می‌کند؛ این رفتار با تست محلی تأیید شده است. حساب‌ها، salt/hash و
توکن GitHub نباید برای چرخاندن کلید نشست تغییر کنند.

بعد از مجوز و در پنجره نگهداری:

```powershell
node -e "require('node:fs').writeFileSync('.cms-local/preflight/session-secret.next', require('node:crypto').randomBytes(48).toString('base64'), {mode:0o600,flag:'wx'})"
Get-Content -Raw -LiteralPath '.cms-local/preflight/session-secret.next' | node node_modules/wrangler/bin/wrangler.js secret put CMS_SESSION_SECRET
```

مقدار به pipe فرستاده می‌شود؛ آن را چاپ، کپی در آرگومان CLI، log یا commit نکنید.
`secret put` خودش نسخه جدید را فوراً deploy می‌کند و تغییر production است؛
نباید هنگام preflight یا بدون مجوز اجرا شود. نشست قبلی باید رد و ورود جدید
باید موفق شود. پس از تأیید، همان مقدار را فقط با ابزار امن محلی با تنظیمات
بایگانی‌شده همگام کنید؛ کل فایل secrets را با `bulk` روی سرویس بازنویسی نکنید.
مرجع rollback را پس از rotation تازه کنید و فایل کلید را خارج از Git نگه دارید.

## ۷. حفاظت از کار محلی

نسخه آغاز این preflight در `.cms-local/preflight-before-20261017-145124/` است.
پشتیبان‌های Task 1 و Task 2 نیز حفظ شده‌اند. بازگشت محلی با مقایسه و کپی دقیق
فایل‌های همین preflight از پشتیبان انجام می‌شود؛ فایل‌های تازه را به آرشیو محلی
منتقل کنید و کار جدیدتر را قبل از آن جداگانه نگه دارید. هیچ دستور مخرب Git
برای آماده‌سازی یا بازگشت محلی لازم نیست.

مراجع رسمی:
[نسخه‌های Worker و assets](https://developers.cloudflare.com/workers/versions-and-deployments/)،
[rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)،
[رفتار Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)،
[مجوزهای fine-grained token](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).
