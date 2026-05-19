import sharp from 'sharp';

const input = 'output/test-55047/p2.png';
const metadata = await sharp(input).metadata();
const { width, height } = metadata;

console.log(`p2: ${width}×${height}`);

const midX = Math.round(width / 2);

await sharp(input)
  .extract({ left: 0, top: 0, width: midX, height })
  .toFile('output/test-55047/p2-left.png');

await sharp(input)
  .extract({ left: midX, top: 0, width: width - midX, height })
  .toFile('output/test-55047/p2-right.png');

const sizes = {};
for (const f of ['p2-left.png', 'p2-right.png']) {
  const m = await sharp(`output/test-55047/${f}`).metadata();
  sizes[f] = `${m.width}×${m.height}`;
}
console.log(`Cropped:`, sizes);
