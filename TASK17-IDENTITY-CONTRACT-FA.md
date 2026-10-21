# Task 17 — قرارداد هویت مشترک و سازگاری دو ویرایشگر

تاریخ: ۲۰۲۶-۱۰-۲۱. مبنا `a5a753c27b28172d598d735c5ee7b081e3401450`؛ شاخه `codex/task17-editor-identity-compatibility`.

## علت و بازتولید

`src/content.js::applyChanges` محصول را با `cloneNode(true)` کپی می‌کرد و فقط HTML id ریشه را عوض می‌کرد. ۲۹ شناسهٔ Builder فرزندان، wrapper تصویر و ارجاع‌های داخلی کپی می‌شدند؛ Builder هنگام بازشدن مالک یکتا نداشت. آزمون دائمی ابتدا با `29 !== 0` شکست خورد؛ شواهد محلی در `.cms-local/task17-qa/regression-before.txt` محفوظ است.

تغییر attribute به‌تنهایی کافی نیست: رکوردهای `#builder-state` نسخه۱/۲، parentId/anchor، CSS، محتوای تصویر/پیوند و رسید انتشار نیز باید مطابق mutation صریح هماهنگ شوند. حذف Legacy نباید بلوک generated را از DOM حذف و رکورد آن را برای بازگشت ناخواسته باقی بگذارد.

## قرارداد اجرایی

- **هویت موجود ثابت:** `public/admin/builder/identity.js` الگوریتم FNV پیشین را عیناً حفظ می‌کند. schemaV2، idVersion، DB و فرمت draft تغییر نکرده‌اند. UUID عناصر تازه و تخصیص map تکثیر در همه مسیرهای جدید مشترک‌اند.
- **تکثیر صریح:** allocator قبل از تغییر محتوا، اعتبار و یکتایی کل map را بررسی می‌کند. clone عنصر اصلی `base-*` تازه و clone عنصر generated شناسه `new-legacy-*` تازه می‌گیرد؛ clone بخشِ اصلی anchor مستقل دارد. شناسه‌های قبلی دست‌نخورده‌اند.
- **graph و ارجاع‌ها:** parentId/anchor، rich-link fragment، data-builder-parent/unit/anchor، HTML id فرزندان، href محلی، ARIA IDREFها، for/headers/list/form و `url(#id)` داخل attribute کپی remap می‌شوند. ارجاع بیرون subtree، URL تصویر و لینک بیرونی بدون قصد صریح تغییر نمی‌کند.
- **قرارداد mutation Legacy:** `src/html-identity.js` ابتدا HTML/Builder/state را بررسی می‌کند، کپی را همراه تنظیمات V1/V2 می‌سازد، فقط رکوردهای حذف‌شده به دست همین عملیات را بازنشسته می‌کند و مرجع یتیم را رد می‌کند. در خطا هیچ خروجی قابل‌ثبت یا commit تولید نمی‌شود.
- **CSS و رسانه:** CSS قبلی در تکثیر حفظ و قواعد clone با renderer مشترک افزوده می‌شود. selectorهای بازنشسته تا هنگام وجود CSS رزرو می‌مانند. تصویر بدون تغییر srcset/variants را نگه می‌دارد؛ تعویض صریح تصویر فقط variantهای همان تصویر را باطل می‌کند. تعویض تصویر clone، SEO تصویر اصل را عوض نمی‌کند.
- **فهرست و محتوای روز:** linkهای موجود model-index با شناسه‌هایشان دوباره استفاده می‌شوند. href و alt عناصر generated از HTML فعلی خوانده می‌شوند؛ ساخت مقاله از template منتشرشده state مربوط به main حذف‌شده را حمل نمی‌کند و page identity تازه می‌گیرد.
- **رسید و revision:** هر mutation Legacy رسید Builder قبلی را باطل می‌کند؛ تکرار درخواست قدیمی پس از تغییر Legacy با conflict رد می‌شود. CAS، publication history و restore referenceهای موجود حفظ شده‌اند.
- **draft:** هیچ rebase یا overwrite خودکار نداریم. JSON/Undo/Redo قبلی روی base معتبر خودش باز می‌شود؛ پس از تغییر revision، export/archive و شروع آگاهانه از صفحهٔ تازه لازم است. raw draft قدیمی حفظ می‌شود.
- **خرابی مبهم:** شناسه HTML/Builder تکراری، state خراب یا تکراری، wrapper تصویر نامعتبر و generated node گمشده fail closed می‌شوند. خواندن یا import به قصد «ترمیم» محتوا را تغییرنام یا حذف نمی‌کند.

## محدودهٔ سازگاری

هویت در scope صفحه است؛ یکسان‌بودن شناسهٔ header در دو صفحه، با page/base متفاوت اشکال یکتایی داخل صفحه نیست. فرمت JSON نسخه۱/۲ و هش قبلی تغییر نکرده‌اند. استفاده هم‌زمان از هر دو ویرایشگر هنوز collaborative editing نیست و اختلاف revision همچنان باید صریح حل شود.

رمز، نقش‌ها، CSRF، cookie، publishing authorization، PWA و رابط‌ها تغییر نکرده‌اند. source record قدیمیِ بدون DOM می‌تواند برای سازگاری خوانده ولی استفاده نشود؛ generated record بدون DOM همچنان خطاست. دادهٔ خراب قدیمی به‌صورت خودکار بازنویسی نمی‌شود؛ برای آن باید revision سالم یا بررسی جدا با backup داشت.

remap مربوط به ارجاع‌های محلی و IDREFهای شناخته‌شده است. parser عمومی برای selectorهای دلخواه در JavaScript/CSS خارجی قالب ایجاد نشده؛ قالب فعلی کلاس‌محور است و هیچ stylesheet مشتری بازنویسی نشده است. پذیرش گوشی فیزیکی ادعا نشده است.

## انتشار و بازگشت آینده

Task17 فقط commit محلی دارد؛ Push، merge و Deploy انجام نمی‌شود. انتشار آینده باید Worker و assets از یک Git tree باشند؛ `/admin/builder/identity.js` همراه importهای تازهٔ schema/blocks/pro-controls/builder الزامی است.

بازگشت محلی با revert عادی commit Task17 است. برای تولید آینده ابتدا main روز، Worker/assets و داده‌های جدید بررسی شوند؛ snapshot قدیمی نباید روی محتوای مشتری کپی شود. خروجی هنوز schemaV2 است، اما برگشت به Legacy معیوب می‌تواند دوباره clone خراب بسازد. JSONها و آرشیوهای جدید در rollback حفظ شوند.

مرجع تاریخی تولید از Task15: Git مبنا و Worker `5432c936-1b64-4f32-b84b-5b63dcdfadad`؛ پیش از استفادهٔ آینده باید مستقلاً دوباره تأیید شوند. هیچ CMS_CORE استخراج نشده است.
