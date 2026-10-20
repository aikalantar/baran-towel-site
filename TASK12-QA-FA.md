# Task 12 — ناوبری CMS و PWA آنلاین

نتیجه: **PASS محلی با تکرار مستند یک timeout آزمون UI**. تمام موارد آزمون تأیید شدند؛ Push، merge و Deploy انجام نشد. SHA محلی نهایی همان HEAD شاخه پس از commit این سند است و در گزارش نهایی و `final-results.json` خصوصی ثبت می‌شود. این گزارش تأیید انتشار production نیست.

مبنا: `5c802e05bd9c906dc084e0edb4cb971699da2ef4`؛ شاخه: `codex/task12-cms-navigation-pwa`؛ تاریخ: ۲۰ اکتبر ۲۰۲۶.

## تشخیص و تغییرها

بررسی فقط‌خواندنی production نشان داد `/admin/` و `/admin/builder/` هر دو ۲۰۰ و دارای title و HTML متفاوت هستند؛ شواهدی از یکسان‌بودن پاسخ سرور وجود ندارد. در کد، gate صفحه‌ساز فقط به `/admin/` لینک می‌داد و CMS پس از ورود همیشه پیشخوان را باز می‌کرد. در موبایل نیز `.sidebar-bottom` پنهان بود و تنها لینک صفحه‌ساز در همین بخش قرار داشت. این دو مشکل گردش کار رفع شدند؛ بازنویسی مسیر Worker لازم نبود.

- صفحه‌ساز بلافاصله زیر پیشخوان و به‌صورت لینک واقعی قرار دارد؛ پیشخوان نیز دکمهٔ واضح بازکردن آن دارد. ناحیهٔ منو مستقل اسکرول می‌شود.
- یک منوی مشترک برای دسکتاپ و موبایل وجود دارد. کشوی موبایل تمام لینک‌ها، نصب و خروج را نگه می‌دارد؛ محتوای پشت آن inert است، focus محصور است، Escape و بازگرداندن focus کار می‌کنند. پس از انتخاب مقصد، focus به عنوان صفحه می‌رود. اندازهٔ کنترل‌های منو حداقل ۴۴ و قلم حداقل ۱۴ پیکسل است؛ RTL و safe area رعایت شده‌اند.
- بازگشت ورود فقط به `/admin/` یا `/admin/builder/` پذیرفته می‌شود؛ فقط `path` صفحهٔ معتبر و `ref` معتبر نگه داشته می‌شوند. آدرس خارجی، backslash، مسیر رمزگذاری‌شده و مسیر API مجاز نیست. این allowlist جایگزین احراز هویت سمت Worker نیست.
- manifest مستقل با id/start_url/scope برابر `/admin/`، نمایش standalone، نام فارسی و آیکون‌های برند موجود افزوده شد. دکمهٔ غیرمزاحم «نصب پنل مدیریت» فقط در صورت وجود event واجد شرایط، پنجرهٔ نصب native مرورگر را فراخوانی می‌کند؛ در نبود آن راهنمای دقیق نشان می‌دهد. Safari iPhone راهنمای Add to Home Screen دارد. در standalone و پس از appinstalled راهنما پنهان می‌شود.
- Service Worker، Cache Storage، توکن مرورگر، cache آفلاین یا تغییر ذخیرهٔ پیش‌نویس اضافه نشده است. پنل آنلاین است؛ نصب دسترسی بدون ورود یا نشست نامحدود ایجاد نمی‌کند. سیاست قبلی `no-store` برای admin/API محفوظ است.

## فرمان‌ها و شواهد

| مجموعه | نتیجهٔ نهایی |
| --- | --- |
| واحد، امنیت، مدل، صفحه، انتشار و چهار آزمون تازه | ۱۵۶ مورد تأیید؛ اجرای کامل اخیر ۱۵۵ موفق و یک timeout؛ همان مورد در تکرار جدا ۱/۱ موفق، صفر مورد حل‌نشده |
| ناوبری، PWA، ورود واقعی workerd، iOS/WebKit و standalone | ۲۲/۲۲؛ صفر خطای JavaScript |
| حفاظت پیش‌نویس و وضعیت انتشار | ۱۹/۱۹ |
| UX ساده/پیشرفته و inspector متن/تصویر | ۲۴/۲۴ |
| مهاجرت و بازیابی V1→V2 | ۱۴/۱۴ |
| بلوک‌ها | ۲۵/۲۵؛ هر ۱۶ بلوک، فارسی/انگلیسی |
| مدیریت صفحات، SEO و چرخهٔ انتشار/حذف | ۱۲/۱۲ |
| تصاویر و نسبت‌ها | ۷/۷ |
| ابزار حرفه‌ای، Free/Flow و responsive | ۲۳/۲۳ |
| Builder، Undo/Redo، history و gate ورود | ۱۷/۱۷، پس از تطبیق آزمون با پیام و لینک ورود جدید |
| انتشار ایزوله | ۱۴/۱۴ |
| CMS قدیمی | ۹/۹ |
| صفحات عمومی، SEO، منو و reduced motion | ۱۵/۱۵؛ هر نه صفحه؛ صفر خطای console |
| Worker با assets واقعی در workerd | ۱۱/۱۱؛ بدون شبکهٔ بیرونی؛ backend GitHub/provider از fixture صریح |
| runtime احراز هویت | login، session، Durable Object rate limit و CSRF موفق |
| کارایی آزمایشگاهی | ۶/۶؛ صفر خطا |
| Cloudflare build validation | dry-run نهایی موفق؛ فایل‌های تازه با Worker موجود سازگارند |

جمع سناریوهای مرورگر: **۲۰۱ = ۱۷۹ موجود + ۲۲ تازه**. تشخیص نصب‌پذیری واقعی Chrome در پروفایل عادی و شبیه‌سازی Android، هر دو صفر خطا داشتند؛ event بومی `beforeinstallprompt` نیز واقعاً مشاهده شد. Chrome برنامهٔ آزمایشی localhost را واقعاً نصب و در standalone اجرا کرد؛ نشست معتبر باقی ماند، start_url پیشخوان بود، Builder و refresh کار کردند و برنامه در پایان uninstall شد. آزمون WebKit نیز با HTTPS محلی، ورود واقعی و راهنمای iPhone موفق بود. eventهای ساختگی نصب/standalone جداگانه و صریح برای شاخه‌های UI استفاده شدند؛ مدرک نصب گوشی واقعی نیستند.

در تست منو، ۳۲۰×۵۶۸، ۳۹۰×۸۴۴، ۷۶۰×۳۹۰، ۷۶۸×۸۰۰ و دسکتاپ کوتاه بررسی شدند؛ هر گزینهٔ منو و خروج واقعاً کلیک شد. حلقهٔ focus، Escape، انتقال focus به عنوان مقصد، اسکرول مستقل، نصب در پایین منو و نبود overflow تأیید شدند. قطع اینترنت باعث شکست fetch خصوصی و reload شد؛ محتوای admin/API از cache تحویل داده نشد. پس از آنلاین‌شدن نشست بازیابی شد؛ Cache Storage و Service Worker registrations خالی ماندند.

هر نه صفحه، sitemap، registry، headers، redirects، manifest عمومی و آیکون‌ها با blob مبنا یکسان‌اند؛ Worker، auth، تنظیم Cloudflare و مدل/draft-safety نیز تغییر نکرده‌اند. checkout ویندوز CRLF دارد؛ تطبیق Git با فیلتر موجود انجام شد و فایل مشتری برای تبدیل line ending بازنویسی نشد. تست‌های ایزولهٔ موجود نیز فایل‌های اصلی workspace را قبل/بعد مقایسه می‌کنند.

اجرای اولیهٔ آزمون setup در PowerShell یک timeout داشت؛ تکرار جدا و اجرای کامل نهایی آن موفق شد. آزمون رندر بلوک‌ها به دامنهٔ ساختگی برای بعضی تصاویر وابسته بود؛ تمام درخواست‌هایش به تصاویر واقعی محلی محدود و دوباره تأیید شد. آزمون قدیمی Builder نیز برای پیام gate قبلی نوشته شده بود؛ اکنون هم پیام تازه و هم مقصد بازگشت را بررسی می‌کند و ۱۷ سناریوی کاملش دوباره موفق شد. اجرای کامل نهایی unit، ۱۵۵ pass و یک cancellation در سناریوی UI حرفه‌ای با سقف ۱۲۰ ثانیه داشت؛ همان سناریو بدون تغییر کد محصول در اجرای جدا با log جزئی، حدود ۵٫۸ ثانیه و بدون خطا موفق شد. این تفاوت در `unit-verified.txt` و `pro-unit-rerun.txt` محفوظ است؛ پایداری زمان اجرای موازی آزمون UI همچنان محدودیت محیط QA است.

```powershell
npm test
npm run test:navigation:pwa
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
git diff --check
```

شواهد خصوصی، logها، نتیجهٔ ساخت، snapshots و تصاویر در `.cms-local/task12-qa/` نگهداری می‌شوند و وارد Git نمی‌شوند. انتشارهای آزمون قدیمی در کپی ایزوله و آزمون GitHub در fixture صریح انجام می‌شوند؛ هیچ‌کدام انتشار آنلاین نیستند. ورود در آزمون تازه واقعی و در workerd محلی است؛ حساب و secret آن تصادفی و آزمایشی‌اند. آزمون WebKit از گواهی خودامضای محیط محلی استفاده می‌کند.

پیش‌نمایش خصوصی و ایزوله: <http://127.0.0.1:7980/admin/>؛ Builder: <http://127.0.0.1:7980/admin/builder/>. پیش‌نمایش به‌صراحت حالت local دارد؛ ذخیره/انتشار آن فقط کپی خصوصی را تغییر می‌دهد.

## محدودیت دستگاه و مرورگر

نصب واقعی و اجرای standalone روی Chrome دسکتاپ محلی از نصب Android WebAPK و Add to Home Screen در iPhone واقعی تفکیک می‌شود. آزمون Android از شبیه‌سازی دستگاه و تشخیص نصب‌پذیری خود Chrome استفاده می‌کند؛ WebKit موتور واقعی آزمون مرورگر است ولی گوشی iPhone واقعی نیست. پذیرش دستگاه واقعی و HTTPS دامنهٔ production مربوط به انتشار جداگانهٔ بعدی است.

شرایط native نصب به مرورگر، نسخه، HTTPS/secure context، تعامل کاربر، حالت ناشناس و وضعیت نصب بستگی دارند؛ نمایش خودکار prompt تضمین نمی‌شود. در تب عادی تشخیص نصب قبلی همهٔ مرورگرها قابل اتکا نیست؛ در خود برنامهٔ standalone راهنما پنهان است. نشست Safari/PWA ممکن است به نسخهٔ iOS و فضای دادهٔ برنامه وابسته باشد و ورود دوباره لازم شود. ویرایش آفلاین، همگام‌سازی دستگاه‌ها و باقی‌ماندن نشست پس از پاک‌کردن داده وعده داده نمی‌شود.

مبنای رفتار نصب: [شرایط Chrome](https://web.dev/articles/install-criteria)، [نصب بدون نیاز به fetch service worker از منوی Chrome](https://developer.chrome.com/blog/update-install-criteria)، [راهنمای رسمی iPhone](https://support.apple.com/guide/iphone/iphea86e5236/ios)، [scope در manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope).

دستور انتشار آینده و rollback در `TASK12-RELEASE-FA.md` است. هیچ Push، merge، Deploy، تغییر secret، تغییر زیرساخت یا تغییر نه صفحهٔ مشتری در این task انجام نمی‌شود.
