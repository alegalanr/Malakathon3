import sharp from 'sharp';

/**
 * Pantallas SINTÉTICAS que imitan la barra inferior de un slot de Pragmatic.
 * Sirven para probar el pipeline sin navegador. NO sustituyen a las capturas reales:
 * cuando las tengáis, poned capturas reales en tests/unit/fixtures/screens/ (recortadas al juego, sin datos de la cuenta).
 */
export interface ScreenSpec {
  width?: number; height?: number;
  credit?: string; bet?: string; rid?: string;
  betLabel?: string; creditLabel?: string;
  popup?: string[];
  noise?: boolean;
}

export async function makeScreen(s: ScreenSpec): Promise<Buffer> {
  const W = s.width ?? 1280, H = s.height ?? 720;
  const barY = Math.round(H * 0.86);
  const f = (px: number) => Math.round((px * H) / 720);
  const t = (x: number, y: number, size: number, txt: string, color = '#fff', anchor = 'start', weight = 'bold') =>
    `<text x="${x}" y="${y}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${f(size)}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${txt}</text>`;
  const noise = s.noise
    ? Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % W}" cy="${(i * 53) % Math.round(H * 0.8)}" r="${f(18)}" fill="#ff${(i * 7 % 90 + 10).toString().padStart(2, '0')}aa" opacity="0.5"/>`).join('')
    : '';
  const popup = s.popup
    ? `<rect x="${W * 0.25}" y="${H * 0.3}" width="${W * 0.5}" height="${H * 0.3}" rx="16" fill="#1d1d3a" stroke="#f5c542" stroke-width="4"/>` +
      s.popup.map((line, i) => t(W / 2, H * 0.4 + i * f(36), 26, line, '#fff', 'middle')).join('')
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b1d6e"/><stop offset="1" stop-color="#0d4f7a"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${noise}
    <rect x="0" y="${barY}" width="${W}" height="${H - barY}" fill="#000" opacity="0.85"/>
    ${t(W * 0.18, barY + f(30), 16, s.creditLabel ?? 'CRÉDITO', '#f5c542')}
    ${t(W * 0.18 + f(110), barY + f(30), 18, s.credit ?? '58,50 €')}
    ${t(W * 0.45, barY + f(30), 16, s.betLabel ?? 'APUESTA', '#f5c542')}
    ${t(W * 0.45 + f(110), barY + f(30), 18, s.bet ?? '2,80 €')}
    ${s.rid ? t(f(12), H - f(12), 13, s.rid, '#cfcfcf', 'start', 'normal') : ''}
    <circle cx="${W * 0.88}" cy="${barY + (H - barY) / 2}" r="${f(40)}" fill="#2ecc71"/>
    ${popup}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
