# Task 12 — انتشار آینده و بازگشت

این task فقط محلی است. Push، merge، Deploy، تغییر secret و تغییر محتوای مشتری مجاز نیست و انجام نمی‌شود. شاخه: `codex/task12-cms-navigation-pwa`؛ مبنا: `5c802e05bd9c906dc084e0edb4cb971699da2ef4`.

## دامنه

ناوبری دسکتاپ/کشوی موبایل CMS، میان‌بر Builder، بازگشت امن پس از ورود و PWA آنلاین با manifest مستقل CMS. مدل، IndexedDB، کلید پیش‌نویس، API انتشار، مجوزها، cookie، Worker و تنظیم Cloudflare تغییر نمی‌کنند. نه صفحه عمومی، sitemap، تصاویر، registry صفحات و manifest عمومی سایت خارج از دامنه‌اند.

فایل‌های HTML و JS تغییرکرده در `public/admin/` همراه شش فایل تازهٔ `navigation.js`، `navigation.css`، `routes.js`، `pwa.js`، `pwa.css` و `cms.webmanifest` باید از یک Git tree منتشر شوند. آیکون‌های موجود `/icon-192-v2.png`، `/icon-512-v2.png` و `/apple-touch-icon-v2.png` استفاده می‌شوند. Service Worker و Cache Storage وجود ندارد؛ این PWA به اینترنت نیاز دارد و ویرایش آفلاین ارائه نمی‌کند. نصب به‌تنهایی مجوز دسترسی یا نشست دائمی ایجاد نمی‌کند.

## بررسی پیش از انتشار مجاز آینده

۱. ابتدا main تازه، diff کامل، Git state و تغییرهای هم‌زمان مشتری را بخوانید. از tree و مراجع deployment و پیش‌نویس‌های مدیر backup خصوصی تازه بگیرید؛ محتوای اصلی را با snapshot قدیمی جایگزین نکنید. SHA نهایی کاندیدا همان HEAD شاخه پس از commit است؛ در گزارش نهایی و شواهد خصوصی ثبت می‌شود.

۲. `npm test`، `npm run test:navigation:pwa` و مجموعه‌های QA درج‌شده در `TASK12-QA-FA.md` را روی tree نهایی اجرا کنید. `npm run deploy:check` فقط dry-run است. آزمون نصب native Chrome پروفایل محلی مستقل می‌سازد و در finally همان برنامهٔ آزمایشی را uninstall می‌کند. نصب روی Android/iPhone واقعی باید در مرحلهٔ پذیرش دستگاه، جداگانه بررسی شود.

۳. فقط با مجوز جداگانه، push معمول و ادغام امن در main تازه انجام دهید. از Git integration موجود Cloudflare استفاده کنید؛ انتشار دستی موازی، force-push، تغییر binding یا چرخش secret لازم نیست. نسخهٔ فعال، ترافیک، دامنه، HEAD و بایت تمام assets تازه را مستقلاً تطبیق دهید؛ commit Git اثبات deployment نیست.

۴. `/admin/` و `/admin/builder/` باید مستقل باز شوند. با نشست معتبر و نشست تازه، درخواست Builder به همراه `path` مجاز و `ref` معتبر، ورود و بازگشت را بررسی کنید. مقصد خارجی و مسیر API باید به پیشخوان محدود شوند. احراز هویت، CSRF و حق انتشار همچنان فقط سمت Worker اعمال می‌شوند.

۵. منوی کوچک ۳۲۰، موبایل افقی، تبلت و دسکتاپ کوتاه، اسکرول مستقل، Tab/Shift+Tab/Escape، خروج، میان‌بر Builder و نشست پس از refresh را بررسی کنید. روی Chrome Android در HTTPS واقعی شرایط نصب و پنجرهٔ native را بررسی کنید؛ روی Safari iPhone راهنمای Share → Add to Home Screen را دنبال کنید. start_url پیشخوان است؛ Builder در همان scope قرار دارد. در standalone راهنمای نصب پنهان است.

۶. Cache Storage و ثبت Service Worker باید خالی بمانند؛ پاسخ‌های admin/API باید `no-store` باشند. از افزودن fallback آفلاین یا کش پاسخ خصوصی برای رفع محدودیت نصب مرورگر خودداری کنید. هر نه صفحه، SEO، تصاویر و CMS قدیمی را دوباره بررسی کنید.

## بازگشت

مرجع سالم ثبت‌شدهٔ Task 11: Git `5c802e05bd9c906dc084e0edb4cb971699da2ef4` و Worker `f932c6e0-11f6-467d-bf8e-fe3ff39161f3` با ترافیک ۱۰۰٪. این اطلاعات تاریخی است و قبل از هر rollback باید با نسخهٔ فعال، secrets و محتوای همان زمان دوباره تطبیق یابد. bundle معتبر پیش از Task 12 در مسیر خصوصی `.cms-local/task12-qa/repository-before.bundle` و backupهای Task 11 محفوظ‌اند.

روش ترجیحی پس از انتشار آینده، revert معمول فقط commit این task روی main تازه و انتشار همان tree با Git integration است. دادهٔ مشتری، پیش‌نویس‌ها، IndexedDB، تاریخچه و secrets پاک یا بازنشانی نشوند. هیچ migration داده یا پاک‌سازی کش مرورگر لازم نیست؛ این task Service Worker نصب نمی‌کند. آیکون نصب‌شده ممکن است تا بازشدن آنلاین بعدی یا تصمیم مرورگر باقی بماند؛ راه‌انداز همچنان `/admin/` است و نسخهٔ قدیمی CMS را باز می‌کند. حذف برنامه فقط به انتخاب کاربر انجام شود.

برای خرابی بحرانی، فعال‌کردن Worker مرجع تنها پس از اثبات سازگاری assets و محتوای روز مجاز است؛ اگر محتوا پس از آن تغییر کرده، از rollback کور نسخهٔ قدیمی استفاده نکنید. پس از بازگشت، GitHub و Cloudflare را هماهنگ و منو، مسیرها، ورود، Builder، پیش‌نویس‌ها و نه صفحه را بررسی کنید. در Task 12 هیچ rollback تولید اجرا نشده است.
