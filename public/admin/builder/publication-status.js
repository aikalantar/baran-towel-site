export function publicationVerified(result){return result?.deployment==='success'&&['cloudflare-active-production-version','github-cloudflare-production-deployment','public-artifacts-match-commit'].includes(result.evidence);}
export function customerPublicationMessage(result){
  if(publicationVerified(result))return result.evidence==='public-artifacts-match-commit'?'انتشار آنلاین تأیید شد؛ محتوای ثبت‌شده روی سایت بررسی شد.':'انتشار آنلاین همین نسخه تأیید شد.';
  if(['failure','error'].includes(result.deployment))return 'انتشار آنلاین ناموفق بود؛ تغییرات ثبت‌شده و پیش‌نویس محفوظ‌اند.';
  if(result.deployment==='superseded')return 'تغییرات شما ثبت شده‌اند، اما نسخهٔ جدیدتری وجود دارد. برای دیدن وضعیت فعلی، نسخهٔ تازه را باز کنید؛ پیش‌نویس محفوظ است.';
  if(result.deployment==='inactive')return 'این نسخه دیگر نسخهٔ فعال سایت نیست؛ پیش‌نویس و ثبت تغییرات محفوظ‌اند.';
  if(result.reason==='publication_manifest_unsupported'||result.reason==='publication_scope_denied')return 'تغییرات ثبت شده‌اند؛ تأیید خودکار این انتشار در دسترس این حساب نیست. از مدیر سایت بخواهید نسخهٔ آنلاین را بررسی کند؛ دوباره منتشر نکنید.';
  if(result.reason==='check_timeout')return (result.previouslyVerifiedAt?'انتشار در بررسی قبلی تأیید شده بود؛ وضعیت فعلی اکنون قابل بررسی نیست. ':'')+'بررسی آنلاین به پایان نرسید؛ اتصال را بررسی کنید و «بررسی انتشار» را بزنید. تغییرات ثبت‌شده و پیش‌نویس محفوظ‌اند.';
  return 'تغییرات ثبت شدند؛ انتشار آنلاین هنوز تأیید نشده است. بررسی خودکار پس از بازگشت به این صفحه ادامه می‌یابد؛ «بررسی انتشار» هم در دسترس است.';
}
export function publicationMessage(result) {
  const commit=result.commit==='committed'?'ثبت تغییرات در GitHub تأیید شد.':'تأیید دوبارهٔ ثبت GitHub اکنون ممکن نیست؛ پیش‌نویس را نگه دارید.';
  const labels={success:'فعال‌شدن همین نسخه در محیط production با شواهد ارائه‌دهنده تأیید شد.',failure:'ارائه‌دهنده شکست استقرار را گزارش کرده است؛ ثبت GitHub محفوظ است.',error:'ارائه‌دهنده خطای استقرار گزارش کرده است؛ ثبت GitHub محفوظ است.',pending:'استقرار در انتظار است؛ فعال‌شدن نسخه هنوز تأیید نشده است.',queued:'استقرار در صف است؛ فعال‌شدن نسخه هنوز تأیید نشده است.',in_progress:'استقرار در حال اجراست؛ فعال‌شدن نسخه هنوز تأیید نشده است.',inactive:'این استقرار دیگر فعال نیست.',superseded:'نسخهٔ جدیدتری در شاخه ثبت شده است؛ این نتیجه نسخهٔ جاری سایت را تأیید نمی‌کند.'};
  const verified=publicationVerified(result);
  const detail=verified?(result.evidence==='public-artifacts-match-commit'?'انتشار محتوای همین تغییرات با تطبیق مستقل همهٔ فایل‌های تغییرکرده روی سایت عمومی تأیید شد.':labels.success):result.deployment!=='success'&&labels[result.deployment]||'ثبت در GitHub با انتشار آنلاین متفاوت است. شواهد کافی برای تأیید نسخهٔ زنده در دسترس نیست؛ این به‌معنای شکست استقرار نیست. کمی بعد «بررسی وضعیت استقرار» را بزنید. اگر تأیید همچنان ممکن نبود، از مسئول فنی بخواهید نسخهٔ فعال Cloudflare را با همین commit تطبیق دهد؛ دوباره منتشر نکنید.';
  const checked=Number.isFinite(Date.parse(result.checkedAt))?` آخرین بررسی: ${new Date(result.checkedAt).toLocaleTimeString('fa-IR')}.`:'';
  return `${commit} ${detail}${verified&&result.version?` شناسهٔ نسخه: ${result.version}.`:''}${checked}`;
}
