// Иконки PWA из SVG (запускается вручную при смене иконки).
import sharp from 'sharp';

const svg = (pad) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#1a56db"/>
<g transform="translate(256 256) scale(${pad ? 0.72 : 0.9}) translate(-256 -256)" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
<path d="M256 96c-62 0-112 48-112 108 0 82 112 196 112 196s112-114 112-196c0-60-50-108-112-108z"/>
<path d="M206 206l36 36 64-70"/>
</g></svg>`);

await sharp(svg(false)).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(svg(false)).resize(512, 512).png().toFile('public/icons/icon-512.png');
await sharp(svg(true)).resize(512, 512).png().toFile('public/icons/icon-maskable-512.png');
await sharp(svg(true)).resize(180, 180).png().toFile('public/icons/apple-touch-icon.png');
console.log('ok');
