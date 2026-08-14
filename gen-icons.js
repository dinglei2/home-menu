const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-256.png', size: 256 },
  { name: 'icon-384.png', size: 384 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

(async () => {
  for (const { name, size } of sizes) {
    const outPath = path.join(__dirname, name);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`Generated ${name} (${size}x${size})`);
  }
  // Also create a favicon
  await sharp(svgBuffer).resize(32, 32).png().toFile(path.join(__dirname, 'favicon.png'));
  console.log('Generated favicon.png (32x32)');
  console.log('All icons generated!');
})();
