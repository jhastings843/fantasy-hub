export interface EmailInput { brand: string; title: string; body: string; kicker?: string; preheader?: string; footer?: string; ink?: string; accent?: string; }
// Field Notes v1. Copy with each deployable consumer; no outside-repo imports.
export function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}

export function textBlocks(text: string) {
  return String(text).split(/\n\s*\n/).filter(Boolean).map(p => `<div style="background:#f1f3ed;padding:18px;border-radius:12px;margin:0 0 14px;font-size:15px;line-height:1.75;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(p).replace(/\n/g,'<br>')}</div>`).join('');
}

export function emailPage({brand, title, body, kicker='YOUR BRIEFING', preheader='', footer='', ink='#193c3b', accent='#d7e8b2'}: EmailInput) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title>
<style>@media only screen and (max-width:480px){.email-pad{padding-left:20px!important;padding-right:20px!important}.email-title{font-size:29px!important}.email-outer{padding:12px 6px!important}}</style></head>
<body style="margin:0;padding:0;background:#f4f1e9;color:#263d37;font-family:'Avenir Next',Avenir,'Segoe UI',sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader || title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f1e9"><tr><td align="center" class="email-outer" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;table-layout:fixed">
<tr><td class="email-pad" bgcolor="${ink}" style="padding:30px 32px;border-radius:18px 18px 0 0;color:#faf8f0">
<div style="font-size:11px;letter-spacing:3px;font-weight:700;color:${accent}">${escapeHtml(brand.toUpperCase())}</div>
<div style="font-size:10px;letter-spacing:1.5px;color:#d0d9d2;margin:24px 0 10px">${escapeHtml(kicker.toUpperCase())}</div>
<h1 class="email-title" style="font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.2;font-weight:normal;margin:0;overflow-wrap:anywhere">${escapeHtml(title)}</h1></td></tr>
<tr><td class="email-pad" bgcolor="#ffffff" style="padding:28px 32px;font-size:15px;line-height:1.75;overflow-wrap:anywhere;word-break:break-word">${body}</td></tr>
<tr><td class="email-pad" bgcolor="#e9ece3" style="padding:22px 32px;border-radius:0 0 18px 18px;color:#536459;font-size:12px;line-height:1.7"><b style="color:${ink};font-size:10px;letter-spacing:2px">${escapeHtml(brand.toUpperCase())} / FIELD NOTES</b>${footer ? '<br>'+footer : ''}</td></tr>
</table></td></tr></table></body></html>`;
}
