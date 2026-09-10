/* Social post rendering.
   Text-to-image models cannot spell. So the AI generates a background only, and
   the post is composed as SVG with real fonts at exact platform dimensions —
   sharp headlines, correct sizes, and you can edit the words without paying for
   another generation. */

import { PLATFORMS } from './ai.js';

/* ── image providers ──────────────────────────────────────────────────────── */

/** Pollinations: no key, no signup. Rate-limited, no uptime guarantee — right
    for trying this out, wrong for a deadline. */
function pollinationsUrl(prompt, w, h, seed) {
  const p = encodeURIComponent(`${prompt}. No text, no words, no letters, no watermark, no logo.`);
  return `https://image.pollinations.ai/prompt/${p}?width=${w}&height=${h}&model=flux&nologo=true&seed=${seed ?? Math.floor(Math.random() * 1e6)}`;
}

/** Cloudflare Workers AI: free daily allowance, needs an account ID and token.
    Slower to set up, far more reliable. Returns a data URI. */
async function cloudflareImage(prompt, w, h) {
  const acct = process.env.CF_ACCOUNT_ID, token = process.env.CF_API_TOKEN;
  if (!acct || !token) throw new Error('Cloudflare image generation needs CF_ACCOUNT_ID and CF_API_TOKEN in .env.');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${prompt}. No text or lettering of any kind.`, steps: 4 }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.errors?.[0]?.message || `Cloudflare Workers AI returned ${res.status}`);
  }
  const b64 = json?.result?.image;
  if (!b64) throw new Error('Cloudflare returned no image data.');
  return `data:image/jpeg;base64,${b64}`;
}

export async function generateBackground(prompt, platform, provider = 'pollinations', seed) {
  const spec = PLATFORMS[platform] || PLATFORMS.instagram_post;
  if (provider === 'cloudflare') {
    return { src: await cloudflareImage(prompt, spec.w, spec.h), provider: 'cloudflare', note: 'Cloudflare Workers AI, FLUX.1 schnell.' };
  }
  if (provider === 'none') return { src: null, provider: 'none', note: 'Flat brand colour, no generated image.' };
  return {
    src: pollinationsUrl(prompt, spec.w, spec.h, seed),
    provider: 'pollinations',
    note: 'Pollinations, no API key. Rate-limited and occasionally slow — if an image fails to load, generate again or switch provider in Setup.',
  };
}

/* ── composition ──────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Greedy wrap on an approximate character advance. Archivo at these weights
    runs about 0.52em average, which is close enough for layout at this size. */
function wrap(text, fontSize, maxWidth, maxLines) {
  const per = fontSize * 0.52;
  const perLine = Math.max(6, Math.floor(maxWidth / per));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > perLine && line) { lines.push(line); line = word; } else { line = next; }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

const LAYOUTS = {
  banner:  { label: 'Text band at the bottom' },
  center:  { label: 'Centred over a scrim' },
  corner:  { label: 'Top-left block' },
  split:   { label: 'Solid panel beside the image' },
};

export const layoutList = () => Object.entries(LAYOUTS).map(([k, v]) => ({ key: k, ...v }));

export function composePost({
  platform = 'instagram_post', headline = '', subhead = '', cta = '', brandName = '',
  imageSrc = null, layout = 'banner', primary = '#17564A', secondary = '#FFFFFF', textOn = 'dark',
}) {
  const spec = PLATFORMS[platform] || PLATFORMS.instagram_post;
  const { w, h } = spec;
  const pad = Math.round(Math.min(w, h) * 0.075);
  const ink = textOn === 'dark' ? '#FFFFFF' : '#14201C';
  const sub = textOn === 'dark' ? 'rgba(255,255,255,.82)' : 'rgba(20,32,28,.75)';

  const isSplit = layout === 'split';
  const textW = isSplit ? Math.round(w * 0.46) - pad * 2 : w - pad * 2;
  const hSize = Math.round(Math.min(w, h) * (platform === 'x' || platform === 'facebook' || platform === 'linkedin' ? 0.082 : 0.094));
  const sSize = Math.round(hSize * 0.42);
  const cSize = Math.round(hSize * 0.34);

  const hLines = wrap(headline, hSize, textW, 4);
  const sLines = subhead ? wrap(subhead, sSize, textW, 3) : [];
  const blockH = hLines.length * hSize * 1.1 + (sLines.length ? sLines.length * sSize * 1.35 + sSize * 0.7 : 0) + (cta ? cSize * 2.4 : 0);

  let tx, ty, anchor = 'start';
  if (layout === 'center') { tx = w / 2; ty = (h - blockH) / 2 + hSize * 0.82; anchor = 'middle'; }
  else if (layout === 'corner') { tx = pad; ty = pad + hSize * 0.82; }
  else if (isSplit) { tx = pad; ty = (h - blockH) / 2 + hSize * 0.82; }
  else { tx = pad; ty = h - pad - blockH + hSize * 0.82; }

  const bg = imageSrc
    ? `<image href="${esc(imageSrc)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${w}" height="${h}" fill="${esc(primary)}"/>`;

  let scrim = '';
  if (imageSrc) {
    if (layout === 'center') scrim = `<rect width="${w}" height="${h}" fill="rgba(10,18,15,.5)"/>`;
    else if (layout === 'banner') scrim = `<rect x="0" y="${h - blockH - pad * 2}" width="${w}" height="${blockH + pad * 2}" fill="url(#fade)"/>`;
    else if (layout === 'corner') scrim = `<rect x="0" y="0" width="${w}" height="${blockH + pad * 2}" fill="url(#fadeTop)"/>`;
  }
  if (isSplit) scrim += `<rect x="0" y="0" width="${Math.round(w * 0.46)}" height="${h}" fill="${esc(primary)}"/>`;

  const tspans = (lines, size, fill, weight, startY, lh) => lines.map((l, i) =>
    `<text x="${tx}" y="${startY + i * size * lh}" text-anchor="${anchor}" fill="${fill}" font-family="Archivo, Helvetica Neue, Arial, sans-serif" font-size="${size}" font-weight="${weight}" letter-spacing="${-size * 0.02}">${esc(l)}</text>`).join('\n    ');

  let y = ty;
  const headBlock = tspans(hLines, hSize, ink, 750, y, 1.1);
  y += hLines.length * hSize * 1.1 + (sLines.length ? sSize * 0.7 : 0);
  const subBlock = sLines.length ? tspans(sLines, sSize, sub, 450, y, 1.35) : '';
  y += sLines.length * sSize * 1.35;

  const ctaBlock = cta ? (() => {
    const bw = Math.min(textW, cta.length * cSize * 0.62 + cSize * 2);
    const bx = anchor === 'middle' ? w / 2 - bw / 2 : tx;
    const by = y + cSize * 0.9;
    return `<rect x="${bx}" y="${by}" width="${bw}" height="${cSize * 2.3}" rx="${cSize * 0.28}" fill="${esc(textOn === 'dark' ? secondary : primary)}"/>
    <text x="${bx + bw / 2}" y="${by + cSize * 1.52}" text-anchor="middle" fill="${esc(textOn === 'dark' ? primary : secondary)}" font-family="Archivo, Helvetica Neue, Arial, sans-serif" font-size="${cSize}" font-weight="650">${esc(cta)}</text>`;
  })() : '';

  const brandMark = brandName
    ? `<text x="${isSplit || layout !== 'center' ? pad : w / 2}" y="${layout === 'corner' ? h - pad : pad + cSize}" text-anchor="${layout === 'center' && !isSplit ? 'middle' : 'start'}" fill="${ink}" opacity=".7" font-family="Archivo, Helvetica Neue, Arial, sans-serif" font-size="${cSize * 0.82}" font-weight="600" letter-spacing="${cSize * 0.05}">${esc(brandName)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(10,18,15,0)"/><stop offset=".55" stop-color="rgba(10,18,15,.72)"/><stop offset="1" stop-color="rgba(10,18,15,.9)"/>
    </linearGradient>
    <linearGradient id="fadeTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(10,18,15,.88)"/><stop offset="1" stop-color="rgba(10,18,15,0)"/>
    </linearGradient>
  </defs>
  ${bg}
  ${scrim}
  ${headBlock}
  ${subBlock}
  ${ctaBlock}
  ${brandMark}
</svg>`;
}
