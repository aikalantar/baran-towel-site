# Task 14 — گزارش QA محلی

نتیجه: **PASS برای پیاده‌سازی و آزمون محلی**. پذیرش روی iPhone و Android فیزیکی انجام نشده است. هیچ Push، merge، Deploy، تغییر secret یا تغییر محتوای تولید انجام نشده است. شاخه `codex/task14-direct-touch-fonts`، مبنا `c8591abfde5886210e447c734093ee3398e44a22`؛ SHA نهایی کاندیدا از `git rev-parse HEAD` پس از commit در گزارش تحویل ثبت می‌شود.

## ممیزی و بازتولید پیش از تغییر

معماری موجود از HTML واقعی سایت در iframe با `sandbox="allow-same-origin"` و بدون اجرای اسکریپت استفاده می‌کرد. مدل/History/IndexedDB و renderer انتشار مشترک بودند. پیش از ویرایش محصول، کپی جداشدهٔ مبنا در Chromium با نمای Pixel 7 و موتور واقعی Playwright WebKit با نمای iPhone 13 آزمایش شد.

در WebKit، تک‌لمس عنوان، تصویر و پیوند هیچ انتخابی ایجاد نکرد. handlerهای سندِ بدون اجرای اسکریپت در این مسیر WebKit به انتخاب نمی‌رسیدند. در Chromium متن و تصویر انتخاب شدند، اما پیوند سربرگ به بخش والد رسید. بوم اولیه در موبایل ۱۴۴۰ پیکسل عرض داشت؛ ارتفاع نوار ابزار حدود ۲۷۶ پیکسل و بوم قابل‌دیدن حدود ۲۶۶ تا ۳۳۶ پیکسل بود. `preventDefault` روی آغاز تمام gestureها و `touch-action:none` روی همهٔ عناصر، لمس/پیمایش را با حرکت محتوا مخلوط می‌کرد. handler کلیک موجود، پیوندها را حتی در Preview هم لغو می‌کرد.

شواهد اولیه در `.cms-local/task14-qa/baseline-reproduction.json` و تصاویر `baseline-webkit-iphone.png` و `baseline-chromium-touch.png` محفوظ‌اند. این بازتولید روی موتور مرورگر و شبیه‌سازی دستگاه است؛ مشاهده روی iPhone فیزیکی نیست.

## تغییرهای تأییدشده

- ویرایش تمام‌صفحه با canvas واقعی، Save/Undo/Redo/Preview/Exit، وضعیت ذخیره و فهرست قابل‌دسترسی عناصر. کنترل‌ها و inspector همان کنترل‌های قبلی‌اند و هنگام خروج به جای اصلی برمی‌گردند.
- پنل زمینه‌ای پایین موبایل و dock دسکتاپ؛ بستن بدون حذف انتخاب، انتخاب دوباره، حرکت امن به والد، هماهنگی لایه‌ها و Enter/Escape.
- hit-test در سند واقعی iframe از والد معتبر، بدون افزودن `allow-scripts`. لمس محتوا برای انتخاب/پیمایش و دستگیرهٔ ۴۴ پیکسلی برای حرکت/اندازه؛ ورودی mouse و ابزارهای حرفه‌ای حفظ شده‌اند.
- جلوگیری از کلیک ثانویهٔ لمس که پس از بازشدن sheet می‌توانست به دکمهٔ «انتخاب والد» برسد. رویداد دیررس `load` صفحهٔ Preview نیز فقط با شناسهٔ سند ویرایش معتبر پذیرفته می‌شود؛ بازگشت به ویرایش پیش‌نویس را دوباره اعمال می‌کند.
- شش قلم OFL محلی: Vazirmatn، Estedad، Shabnam، Sahel، Inter و Lato. قلم فعلی پیش‌فرض است؛ نمونه از متن واقعی، بارگیری در صورت استفاده، fallback و ارث‌بری مستقل breakpoint و CSS ایستای مشترک Worker/canvas تأیید شدند. نمونهٔ قلمِ ارث‌رسیده از ظرف نیز بدون ایجاد override تازه روی فرزند بارگیری می‌شود.
- وضعیت ذخیره و بازیابی JSON بالای لایهٔ تمام‌صفحه قابل‌دیدن‌اند. اندازهٔ viewport کوچک‌شده برای ورودی بررسی شد؛ این آزمون شبیه‌سازی هندسهٔ صفحه‌کلید است.

## نتایج دقیق

همهٔ اجراهای زیر exit code صفر داشتند؛ شواهد خام در `.cms-local/task14-qa/` هستند. انتشارهای آزمون فقط کپی‌های جداشدهٔ محلی را تغییر دادند.

| اجرا | نتیجه |
|---|---:|
| `npm test`، شامل ۶ آزمون تازهٔ قلم/امنیت/انتشار | ۱۶۲/۱۶۲ |
| `test/builder-browser.mjs` | ۱۷/۱۷ |
| `test/builder-publish-browser.mjs` | ۱۴/۱۴ |
| `test/freeform-browser.mjs` | ۲۳/۲۳ |
| `test/migration-browser.mjs` | ۱۴/۱۴ |
| `test/task6-blocks-browser.mjs`، همهٔ ۱۶ بلوک | ۲۵/۲۵ |
| `test/task6-pages-browser.mjs` | ۱۲/۱۲ |
| `test/media-ratio-browser.mjs` | ۷/۷ |
| `test/customer-ux-browser.mjs` | ۲۴/۲۴ |
| `test/stabilization-browser.mjs` | ۱۹/۱۹ |
| `test/cms-browser.mjs` | ۹/۹ |
| `test/release-browser.mjs`، نه صفحهٔ اصلی | ۱۵/۱۵ |
| `test/navigation-pwa-browser.mjs` | ۲۲/۲۲ |
| `test/performance-local.mjs`، آزمایشگاهی | ۶/۶ |
| `npm run test:builder:direct` | ۵۸/۵۸ |
| `npm run test:builder:fonts` | ۵/۵ |
| `test/release-runtime.mjs`، workerd و پروتکل GitHub جداشده | ۱۱/۱۱ |
| `test/cms-runtime.mjs` | ورود، نشست، rate limit و CSRF: موفق |
| `npm run deploy:check` | dry-run موفق؛ هیچ استقرار واقعی |

مجموع مرورگر/عملکرد: **۲۷۰ سناریو**. در مجموعهٔ مستقیم، Chromium دسکتاپ، Chromium لمسی با نمای Pixel 7، WebKit با نمای iPhone 13 و WebKit با نمای iPad آزمایش شدند. تک‌لمس از API واقعی touchscreen مرورگر ارسال شد؛ swipe، حرکت و resize لمسی Chromium از CDP native touch sequence استفاده کردند. dispatch مصنوعی رویداد DOM به‌عنوان موفقیت تک‌لمس گزارش نشده است.

آزمون‌ها انتخاب فوری متن/تصویر/پیوند، تغییر تنظیمات زمینه‌ای، تکرار لمس، بستن، والد، بلوک تو‌در‌تو، RTL/LTR، Simple/Advanced، بازگشت Preview، ذخیره/refresh، Undo/Redo، خطای واقعی تراکنش IndexedDB، حفظ draft معتبر، JSON تازه و retry را پوشش دادند. خروجی انتشار محلی هر شش WOFF2 در Chromium و WebKit decode شد و قلم سه breakpoint از CSS واقعی کنترل شد. رگرسیون جداگانه هشدار refresh، بستن تب و navigation هنگام خطای ذخیره را بررسی کرد.

تطبیق با Git مبنا، نه صفحهٔ عمومی و ۸ فایل دیگرِ SEO/استایل/امنیت را بایت‌به‌بایت بدون تغییر نشان داد (`preservation.json`). آزمون‌های انتشار نیز صفحات اصلی کپی جداشده و workspace را بدون تغییر تأیید کردند. secrets، نشست مدیر تولید، PWA، فایل‌های مشتری و backupهای پیشین دست‌کاری نشدند.

## تصاویر و پیش‌نمایش

تصاویر محلی در `.cms-local/task14-qa/`:

- `webkit-iphone-text.png` و `webkit-iphone-image.png`: انتخاب واقعی لمسی و sheet.
- `chromium-desktop-text.png`: بوم تمام‌صفحه و inspector دسکتاپ.
- `webkit-tablet-text.png`: تبلت.
- `compact-viewport-input.png`: عرض ۳۲۰ و فضای کوچک‌شدهٔ ورودی.
- `published-fonts-WebKit.png` و `published-fonts-Chromium.png`: خروجی ایستای قلم‌ها.

پیش‌نمایش: `http://127.0.0.1:7994/admin/builder/?path=public%2Findex.html` و پیشخوان `http://127.0.0.1:7994/admin/`. سرور از کپی مجزا استفاده می‌کند؛ publish در آن فقط محلی است و به GitHub/Cloudflare دسترسی نوشتنی نمی‌دهد.

## محدودیت و آمادگی

هیچ گوشی فیزیکی متصل نبود. لمس و رندر موتور WebKit جای پذیرش Safari روی iPhone واقعی را نمی‌گیرد؛ اینرسی، صفحه‌کلید مجازی، چرخش، safe-area، مرورگر داخل برنامه و standalone واقعی گوشی باید دستی تأیید شوند. Android واقعی نیز در انتظار همین پذیرش است. کنترل ورودی ویرایش، پیمایش را در والد مدیریت می‌کند و ادعای اینرسی کاملاً یکسان با مرورگر بومی ندارد.

Preview بوم همچنان سندِ بدون اجرای اسکریپت است؛ رفتار پیوندهای عادی آن آزمایش شده است. پیش‌نمایش تعاملی خروجی با قابلیت موجود «نمایش خروجی» جداگانه ارائه می‌شود. هیچ ادعای ویرایش آفلاین یا موفقیت تولید در این گزارش وجود ندارد.

کاندیدای محلی برای بازبینی و پذیرش دستگاه آماده است. انتشار تولید به مجوز جداگانه، Worker و assets هماهنگ، تطبیق نسخهٔ فعال و پذیرش دستگاه نیاز دارد. دستور بازگشت و احتیاط حفظ draftهای دارای قلم تازه در `TASK14-RELEASE-FA.md` ثبت شده است.
