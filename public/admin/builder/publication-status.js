export function publicationMessage(result) {
  const commit=result.commit==='committed'?'ثبت تغییرات در GitHub تأیید شد.':'تأیید دوبارهٔ ثبت GitHub اکنون ممکن نیست؛ پیش‌نویس را نگه دارید.';
  const labels={success:'فعال‌شدن همین نسخه در محیط production با شواهد ارائه‌دهنده تأیید شد.',failure:'ارائه‌دهنده شکست استقرار را گزارش کرده است؛ ثبت GitHub محفوظ است.',error:'ارائه‌دهنده خطای استقرار گزارش کرده است؛ ثبت GitHub محفوظ است.',pending:'استقرار در انتظار است؛ فعال‌شدن نسخه هنوز تأیید نشده است.',queued:'استقرار در صف است؛ فعال‌شدن نسخه هنوز تأیید نشده است.',in_progress:'استقرار در حال اجراست؛ فعال‌شدن نسخه هنوز تأیید نشده است.',inactive:'این استقرار دیگر فعال نیست.',superseded:'نسخهٔ جدیدتری در شاخه ثبت شده است؛ این نتیجه نسخهٔ جاری سایت را تأیید نمی‌کند.'};
  const verified=result.deployment==='success'&&['cloudflare-active-production-version','github-cloudflare-production-deployment'].includes(result.evidence);
  const detail=verified?labels.success:result.deployment!=='success'&&labels[result.deployment]||'ثبت در GitHub با انتشار آنلاین متفاوت است. شواهد کافی برای تأیید نسخهٔ زنده در دسترس نیست؛ این به‌معنای شکست استقرار نیست. کمی بعد «بررسی وضعیت استقرار» را بزنید. اگر تأیید همچنان ممکن نبود، از مسئول فنی بخواهید نسخهٔ فعال Cloudflare را با همین commit تطبیق دهد؛ دوباره منتشر نکنید.';
  const checked=Number.isFinite(Date.parse(result.checkedAt))?` آخرین بررسی: ${new Date(result.checkedAt).toLocaleTimeString('fa-IR')}.`:'';
  return `${commit} ${detail}${verified&&result.version?` شناسهٔ نسخه: ${result.version}.`:''}${checked}`;
}
