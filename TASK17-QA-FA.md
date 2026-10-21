# Task 17 — نتیجه اصلاح و QA محلی

**PASS** — ۲۰۲۶-۱۰-۲۱. مبنا: `a5a753c27b28172d598d735c5ee7b081e3401450`؛ شاخه `codex/task17-editor-identity-compatibility`. SHA commit نهایی در تحویل و `.cms-local/task17-qa/final-result.json` ثبت می‌شود.

## نتیجه و علت

نقص P0 روی همان کاتالوگ واقعی بازتولید شد: ثبت Builder → cloneNode در Legacy → تکرار۲۹شناسه → شکست بازشدن Builder. آزمون دائمی ابتدا با `29 !== 0` قرمز شد؛ سپس با همان assert صفر تکرار موفق شد. کد قبلی فقط id ریشه محصول را عوض می‌کرد و metadata/graph/state مربوط به فرزندان را هماهنگ نمی‌کرد.

اصلاح شامل allocator/remapper مشترک و قرارداد mutation صریح است. اصل شناسه‌ها، تنظیمات breakpoint، متن/عکس، linkهای model-index و CSS حفظ می‌شوند. cloneهای فرزند/بخش اصلی هویت جدا و ارجاع داخلی تازه دارند؛ حذف رکورد generated را بازنشسته می‌کند؛ رسید قبلی پس از تغییر Legacy معتبر نیست. الگوریتم هش اصلی، schemaV2، فرمت‌های V1/V2، DB، CAS، امنیت و ظاهر دو رابط تغییر نکرده‌اند.

شرح قرارداد و بازگشت در [TASK17-IDENTITY-CONTRACT-FA.md](./TASK17-IDENTITY-CONTRACT-FA.md) است.

## نتیجه دقیق آزمون‌ها

|اجرا|موفق|
|---|---:|
|npm test؛ امنیت/API، schema، publishing، history، V1/V2 و۹ آزمون دائمی جدید|۱۷۱/۱۷۱|
|رفت‌وبرگشت جدید UI در Chromium و WebKit لمسی|۱۶/۱۶، خطای مرورگر صفر|
|Builder پایه|۱۷/۱۷|
|انتشار Builder|۱۴/۱۴|
|Free/Flow، گروه، قفل، هندسه و CSS|۲۳/۲۳|
|مهاجرت مرورگری|۱۴/۱۴|
|CMS قدیمی|۹/۹|
|ویرایش مستقیم، چهار نمای desktop/touch/iPhone/iPad|۵۸/۵۸|
|رسانه و نسبت تصویر|۷/۷|
|همه۱۶بلوک؛ افزودن/حرکت/اندازه/تکثیر/حذف/واگرد/بازانجام|۲۵/۲۵|
|صفحات عمومی و SEO/assets/navigation|۱۵/۱۵|
|workerd با auth و GitHub protocol جداشده|۱۱/۱۱، درخواست خارجی واقعی صفر|
|Wrangler build dry-run آخر|موفق؛ هیچ Deploy واقعی|

جمع suites مرورگر: **۱۹۸سناریو**؛ جدا از۱۷۱آزمون واحد و۱۱runtime. پنج suite موفق اولیهٔ همین Task17 که از مشکل محیط متأثر نبودند بازاستفاده شدند؛ موارد ناقص یا ناموفق در عدد نهایی وارد نشده‌اند. اجرای نهایی اصلی با exit code صفر و log مستقل ثبت شده است.

## پوشش رفت‌وبرگشت

- Legacy → ساخت محصول → Builder → Legacy → Builder، و جهت معکوس؛ متن، نام محصول، ترتیب، حذف و restore تاریخی، چند بار ذخیره/انتشار/بازشدن.
- clone۲۹عنصری اصل، clone ظرف generated تو‌در‌تو و clone بخشی که خودش anchor اصلی است؛ هویت اصل و والد/فرزند ثابت و clone یکتا.
- HTML/ARIA/fragment و picture-unit، تصویر بدون تغییر و variant/srcset، تصویر جایگزین و نام/alt، CSS و overrideهای سه اندازه؛ تصویر clone تصویر اصل یا SEO آن را تغییر نمی‌دهد.
- JSON و history معتبر V1/V2، Undo/Redo، stale draft بدون rebase خودکار؛ در UI ابتدا خروجی draft قبلی و آرشیو، سپس شروع صریح از نسخه تازه.
- invalid/duplicate HTML/Builder/state IDs و JSON خراب رد می‌شوند؛ هیچ اصلاح حدسی، حذف خام داده یا commit ناخواسته انجام نمی‌شود. رسید قدیمی پس از mutation Legacy با conflict رد می‌شود.
- تماس سراسری و href عنصر generated، مقاله تازه از template قبلاً منتشرشده و افزودن آن به index، بدون حمل state مربوط به main حذف‌شده.

کاتالوگ انگلیسی واقعی PDFمحور است و محصول card ندارد؛ آزمون API محصول روی route انگلیسی از fixture محصولِ صریحاً جداشده استفاده کرد. این نتیجه به‌عنوان وجود مدل محصول در محتوای اصلی انگلیسی گزارش نمی‌شود.

## حفاظت داده و دامنه تغییر

هر نه صفحه اصلی هم با snapshot خامِ محفوظ Task16 و هم با checkout مبنای Git، **بایت‌به‌بایت برابر** است؛ SHA256ها در `.cms-local/task17-qa/validation.json` آمده‌اند. مقایسه Git با checkout filters انجام شد تا CRLF ویندوز با blob LF اشتباه نشود؛ مقایسه snapshot خام هیچ normalization ندارد. پنج گزارش Task16 نیز با checksum قبلی برابرند و خارج از commit این task باقی می‌مانند.

هیچ محتوای تولید، draft مدیر، secret، binding، PWA، auth، مسیر عمومی یا infrastructure تغییر نکرد. تمام انتشارهای آزمون روی repo/file copy جدا انجام شدند. هیچ Push، merge، Deploy یا استخراج CMS_CORE انجام نشده است.

فایل‌های محصول/پیکربندی: `src/content.js`، `src/builder.js`، فایل تازهٔ `src/html-identity.js`، `public/admin/builder/identity.js` تازه، و import/استفاده مشترک در `builder.js`، `blocks.js`، `pro-controls.js`، `schema.js`؛ `package.json` فقط برای اجرای دائمی آزمون‌ها. آزمون‌های تازه: `test/identity-interop.test.mjs` و `test/identity-interop-browser.mjs`.

## محدودیت‌ها و تلاش‌های ناموفق

داده‌ای که قبلاً به‌صورت مبهم خراب شده خودکار بازنویسی نمی‌شود؛ نیاز به revision سالم یا بررسی جدا دارد. draft با base تغییرکرده همچنان export/archive و بازکردن نسخه جدید می‌خواهد. selectorهای دلخواه داخل JS/CSS خارجی قالب‌های دیگر parser عمومی نشده‌اند. پذیرش فیزیکی iPhone/Android در این task انجام نشده؛ WebKit/Chromium شبیه‌سازی مرورگرند.

یک انتظار ابتدایی تست، به‌اشتباه وجود product-card در صفحه انگلیسی PDFمحور را فرض می‌کرد؛ با fixture صریح اصلاح شد. دو توقف browser از زمان تعامل/خروج زودهنگام قبل پایان refresh صفحه بودند؛ harness اکنون تک‌لمس native و اتمام flow ذخیره را انتظار می‌کشد، بدون تغییر UI محصول یا نادیده‌گرفتن pageerror. اجرای نهایی۱۶سناریو errors=0 است.

درایو A در میانه QA با ENOSPC پر شد؛ خروجی ناقص آن اجراها موفق حساب نشد. کپی‌های disposable متعلق به همین Task17 به C بایگانی شدند؛ حذف خودکار ابزار مسدود شد و هیچ backup قبلی حذف نشد. داده‌های آزمون مرورگر جدید در temp درایو سیستم ساخته می‌شوند؛ خروجی‌های نهایی در `C:/Users/ComCell/.codex/visualizations/2026/10/19/01a15223-b1b4-75e1-bb81-35901b541d7f/task17-final-qa` هستند. شواهد اولیه در `C:/Users/ComCell/.codex/visualizations/2026/10/19/01a15223-b1b4-75e1-bb81-35901b541d7f/task17-disposable` و فایل‌های کوچک/تصاویر Task17 در `.cms-local/task17-qa` حفظ شده‌اند.

## آمادگی

**مانع P0 بسته است و پروژه برای فاز بعدی UX آماده است.** این به معنی آماده‌بودن استخراج فوری production CMS_CORE نیست؛ adapter/config، namespace draft، پذیرش انسانی و گیت‌های دیگر Task16 همچنان مستقل‌اند. فقط commit محلی مجاز این task انجام می‌شود؛ انتشار آینده مجوز و بررسی نسخه‌های سازگار Worker/assets می‌خواهد.
