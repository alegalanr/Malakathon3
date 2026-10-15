import sharp from 'sharp';

/**
 * Réplica en SVG del juego falso del modo simulado (simulateScenario.fakeGameHtml):
 * etiqueta e importe en UN SOLO texto ("APUESTA 4,00 €"), con un solo espacio entre ellos.
 * Es el caso que destapó el "1" de más: la zona del importe se comía la última A de APUESTA.
 */
export async function makeFakeGame(o: { credit: string; bet: string; rid?: string; message?: string[] }): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const reels = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'].map((c, i) => `<rect x="${190 + i * 185}" y="90" width="165" height="470" fill="${c}"/>`).join('');
  const msg = o.message
    ? `<rect width="1280" height="630" fill="rgba(0,0,0,.6)"/><rect x="340" y="220" width="600" height="200" fill="#fff"/>` +
      `<text x="380" y="300" font-family="DejaVu Sans" font-weight="bold" font-size="34" fill="#111">${esc(o.message[0])}</text>` +
      `<text x="380" y="355" font-family="DejaVu Sans" font-size="24" fill="#111">${esc(o.message[1] ?? '')}</text>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0b45"/><stop offset="1" stop-color="#0b2a45"/></linearGradient></defs>
    <rect width="1280" height="720" fill="url(#g)"/>${reels}
    <rect x="0" y="630" width="1280" height="90" fill="#0d0d14"/>
    <text x="360" y="688" font-family="DejaVu Sans" font-weight="bold" font-size="30" fill="#fff">CRÉDITO ${esc(o.credit)}</text>
    <text x="800" y="688" font-family="DejaVu Sans" font-weight="bold" font-size="30" fill="#fff">APUESTA ${esc(o.bet)}</text>
    ${o.rid ? `<text x="18" y="708" font-family="DejaVu Sans" font-size="20" fill="#d0d0d0">#${esc(o.rid)}</text>` : ''}
    ${msg}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
