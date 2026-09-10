/* Procedural backgrounds — generated locally, no image API, no network.
   Six styles derived from the brand colour and a seed. They are abstract by
   design: an abstract background behind real typography reads as deliberate
   design, whereas a mediocre AI photo behind text reads as a stock-photo
   accident. This is the default, and it works offline forever. */

const hex = (h) => {
  const s = String(h || '#17564A').replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const toHex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const shade = (c, t) => (t < 0 ? mix(c, { r: 8, g: 14, b: 12 }, -t) : mix(c, { r: 255, g: 255, b: 255 }, t));

/** Deterministic PRNG so a seed always regenerates the same artwork. */
function rng(seed) {
  let s = (seed || 1) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

/** Rotate the hue so a single brand colour still yields a varied palette. */
function hueShift({ r, g, b }, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const m = [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
  return { r: r * m[0] + g * m[1] + b * m[2], g: r * m[3] + g * m[4] + b * m[5], b: r * m[6] + g * m[7] + b * m[8] };
}

export const STYLES = [
  { key: 'mesh', label: 'Soft mesh' },
  { key: 'strata', label: 'Layered strata' },
  { key: 'grid', label: 'Fine grid' },
  { key: 'arcs', label: 'Concentric arcs' },
  { key: 'dunes', label: 'Dunes' },
  { key: 'facets', label: 'Facets' },
];

export function background(style, w, h, primary, seed = 7) {
  const r = rng(seed * 2654435761);
  const base = hex(primary);
  const dark = toHex(shade(base, -0.55));
  const mid = toHex(base);
  const light = toHex(shade(base, 0.3));
  const alt = toHex(hueShift(base, 40 + r() * 60));
  const id = `g${Math.floor(seed * 977) % 99999}`;

  const D = Math.max(w, h);
  let defs = '', body = '';

  if (style === 'mesh') {
    // Overlapping radial blooms — the calmest option, best behind long headlines.
    defs = `<radialGradient id="${id}a" cx="20%" cy="18%" r="85%"><stop offset="0" stop-color="${alt}" stop-opacity=".9"/><stop offset="1" stop-color="${dark}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}b" cx="82%" cy="72%" r="80%"><stop offset="0" stop-color="${light}" stop-opacity=".75"/><stop offset="1" stop-color="${dark}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}c" cx="55%" cy="98%" r="70%"><stop offset="0" stop-color="${mid}" stop-opacity=".85"/><stop offset="1" stop-color="${dark}" stop-opacity="0"/></radialGradient>`;
    body = `<rect width="${w}" height="${h}" fill="${dark}"/>
    <rect width="${w}" height="${h}" fill="url(#${id}a)"/>
    <rect width="${w}" height="${h}" fill="url(#${id}b)"/>
    <rect width="${w}" height="${h}" fill="url(#${id}c)"/>`;
  } else if (style === 'strata') {
    const bands = 7 + Math.floor(r() * 4);
    let paths = '';
    for (let i = 0; i < bands; i++) {
      const t = i / bands;
      const y = h * (0.28 + t * 0.85);
      const amp = h * (0.045 + r() * 0.07);
      paths += `<path d="M0 ${y} C ${w * 0.3} ${y - amp}, ${w * 0.68} ${y + amp}, ${w} ${y - amp * 0.5} L ${w} ${h} L 0 ${h} Z" fill="${toHex(mix(hex(alt), hex(dark), 0.25 + t * 0.7))}" opacity="${(0.95 - t * 0.35).toFixed(2)}"/>`;
    }
    body = `<rect width="${w}" height="${h}" fill="${toHex(shade(base, 0.12))}"/>${paths}`;
  } else if (style === 'grid') {
    const step = Math.round(D / (26 + Math.floor(r() * 14)));
    defs = `<pattern id="${id}p" width="${step}" height="${step}" patternUnits="userSpaceOnUse">
      <path d="M ${step} 0 L 0 0 0 ${step}" fill="none" stroke="${light}" stroke-width="1" opacity=".28"/></pattern>
    <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`;
    body = `<rect width="${w}" height="${h}" fill="url(#${id}g)"/><rect width="${w}" height="${h}" fill="url(#${id}p)"/>
    <circle cx="${w * (0.15 + r() * 0.7)}" cy="${h * (0.15 + r() * 0.6)}" r="${D * 0.2}" fill="${alt}" opacity=".3"/>`;
  } else if (style === 'arcs') {
    let rings = '';
    const cx = w * (0.2 + r() * 0.6), cy = h * (0.2 + r() * 0.6);
    for (let i = 10; i > 0; i--) {
      rings += `<circle cx="${cx}" cy="${cy}" r="${(D * 0.09) * i}" fill="none" stroke="${toHex(mix(hex(light), hex(dark), i / 10))}" stroke-width="${Math.max(1.5, D * 0.006)}" opacity="${(0.15 + (10 - i) * 0.055).toFixed(2)}"/>`;
    }
    body = `<rect width="${w}" height="${h}" fill="${dark}"/>${rings}`;
  } else if (style === 'dunes') {
    defs = `<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${toHex(hueShift(base, 25))}"/><stop offset="1" stop-color="${dark}"/></linearGradient>`;
    let waves = '';
    for (let i = 0; i < 5; i++) {
      const y = h * (0.42 + i * 0.13);
      waves += `<path d="M0 ${y} Q ${w * 0.25} ${y - h * (0.09 + r() * 0.06)} ${w * 0.5} ${y} T ${w} ${y - h * 0.03} L ${w} ${h} L 0 ${h} Z" fill="${dark}" opacity="${(0.2 + i * 0.16).toFixed(2)}"/>`;
    }
    body = `<rect width="${w}" height="${h}" fill="url(#${id}g)"/>${waves}`;
  } else {
    const cells = 9 + Math.floor(r() * 6);
    let tris = '';
    for (let i = 0; i < cells; i++) {
      const x1 = r() * w, y1 = r() * h, sz = D * (0.14 + r() * 0.26);
      tris += `<polygon points="${x1},${y1} ${x1 + sz},${y1 + sz * 0.4} ${x1 + sz * 0.35},${y1 + sz}" fill="${toHex(mix(hex(alt), hex(dark), r()))}" opacity="${(0.24 + r() * 0.4).toFixed(2)}"/>`;
    }
    body = `<rect width="${w}" height="${h}" fill="${toHex(shade(base, -0.35))}"/>${tris}`;
  }

  // A faint grain stops large flat gradients looking like a rendering error.
  const grain = `<filter id="${id}n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3"/>
    <feColorMatrix type="saturate" values="0"/></filter>
  <rect width="${w}" height="${h}" filter="url(#${id}n)" opacity=".055"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}${grain}</svg>`;
}

/** Data URI so it drops straight into the composer's <image href>. */
export function backgroundDataUri(style, w, h, primary, seed) {
  const svg = background(style, w, h, primary, seed);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
