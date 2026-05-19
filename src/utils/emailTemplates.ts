const baseStyles = `
  body { background:#0b0b0c; margin:0; padding:32px 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#ffffff; }
  .card { max-width:520px; margin:0 auto; background:#111315; border:1px solid #1f2326; border-radius:16px; padding:32px; }
  .brand { font-size:14px; font-weight:600; letter-spacing:2px; color:#24d3ee; text-transform:uppercase; margin-bottom:24px; }
  h1 { font-size:22px; margin:0 0 16px 0; color:#ffffff; }
  p { font-size:15px; line-height:1.5; color:#cdd3d8; margin:0 0 16px 0; }
  .code { display:block; font-size:36px; letter-spacing:8px; font-weight:600; color:#24d3ee; background:#0b3845; padding:18px 0; text-align:center; border-radius:12px; margin:24px 0; font-variant-numeric:tabular-nums; }
  .btn { display:inline-block; background:#24d3ee; color:#0b3845 !important; text-decoration:none; padding:12px 24px; border-radius:10px; font-weight:600; font-size:15px; }
  .muted { color:#7a8086; font-size:13px; margin-top:24px; }
`;

function wrap(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body><div class="card"><div class="brand">OKAK</div>${inner}</div></body></html>`;
}

export function renderCodeEmail(input: { heading: string; intro: string; code: string; outro: string }): string {
  return wrap(
    `<h1>${input.heading}</h1>` +
    `<p>${input.intro}</p>` +
    `<div class="code">${input.code}</div>` +
    `<p class="muted">${input.outro}</p>`
  );
}

export function renderLinkEmail(input: { heading: string; intro: string; buttonLabel: string; url: string; outro: string }): string {
  return wrap(
    `<h1>${input.heading}</h1>` +
    `<p>${input.intro}</p>` +
    `<p><a class="btn" href="${input.url}">${input.buttonLabel}</a></p>` +
    `<p class="muted">${input.outro}</p>`
  );
}
