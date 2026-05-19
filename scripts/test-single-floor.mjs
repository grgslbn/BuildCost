import { readFileSync, writeFileSync } from 'fs';

const API_KEY = readFileSync('C:\\Users\\tieme\\Documents\\Claude\\Projects\\BuildCost\\.env.local', 'utf-8')
  .match(/BUILDCOST_ANTHROPIC_KEY=(.+)/)?.[1]?.trim();

const imageData = readFileSync('output/test-54756/p8.png');

const system = `You are a Belgian building plan analyst. You analyze architectural floor plans to extract precise surface area data.

TASK: Analyze this SINGLE apartment floor plan. For each apartment on this floor:
1. Identify the apartment (by position: top-left, top-right, bottom-left, etc. or by unit number if visible)
2. List EVERY room you can see with its label
3. For each room, estimate its dimensions (length × width in meters) using door openings as reference (interior door = 80cm in Belgium)
4. Calculate each room's area
5. Sum all rooms = net floor area for that apartment
6. Convert to BO: net / 0.85 = bruto oppervlakte

Also identify common areas (stairwell, elevator, corridors) and their areas.

Return JSON:
{
  "calibration": "how you determined the scale (e.g., door opening = X pixels = 80cm)",
  "apartments": [
    {
      "position": "top-left / unit number",
      "bedroom_count": 2,
      "rooms": [
        {"name": "living/eetplaats", "dims": "5.2m × 4.1m", "area_sqm": 21.3},
        {"name": "keuken", "dims": "3.0m × 2.5m", "area_sqm": 7.5}
      ],
      "net_sqm": 68.8,
      "bo_sqm": 80.9
    }
  ],
  "common_areas": [
    {"name": "trappenhal", "area_sqm": 12.0},
    {"name": "liftkoker", "area_sqm": 5.0}
  ],
  "floor_total_enclosed_bo": 0,
  "floor_total_terraces": 0
}`;

const content = [
  { type: 'text', text: `This is floor 1 (1ste verdieping) of Residentie MURANO, an apartment building in Bredene. This is a SINGLE floor. Identify every apartment, list every room, measure dimensions using door openings (80cm) as your scale reference. Be precise.` },
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData.toString('base64') } }
];

console.log('Sending floor 1 (p8) for detailed apartment analysis...\n');

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system, messages: [{ role: 'user', content }] }),
  signal: AbortSignal.timeout(120_000)
});

const result = await response.json();
const rawText = result.content[0]?.text || '';
console.log('Tokens:', result.usage?.input_tokens, 'in /', result.usage?.output_tokens, 'out');
console.log('');

let parsed;
try {
  parsed = JSON.parse(rawText);
} catch {
  const m = rawText.match(/```json?\s*\n([\s\S]*?)\n```/);
  if (m) parsed = JSON.parse(m[1]);
  else {
    const f = rawText.indexOf('{'), l = rawText.lastIndexOf('}');
    if (f !== -1) parsed = JSON.parse(rawText.slice(f, l + 1));
  }
}

if (parsed) {
  console.log('Calibration:', parsed.calibration);
  console.log('');

  let totalBo = 0, totalTerr = 0;
  for (const apt of parsed.apartments || []) {
    console.log(`Apartment: ${apt.position} (${apt.bedroom_count} slpk)`);
    for (const r of apt.rooms || []) {
      console.log(`  ${r.name.padEnd(25)} ${(r.dims||'').padEnd(14)} ${r.area_sqm} m²`);
    }
    console.log(`  NET: ${apt.net_sqm} m² → BO: ${apt.bo_sqm} m²`);
    totalBo += apt.bo_sqm || 0;
    console.log('');
  }

  console.log('Common areas:');
  let commonTotal = 0;
  for (const c of parsed.common_areas || []) {
    console.log(`  ${c.name}: ${c.area_sqm} m²`);
    commonTotal += c.area_sqm || 0;
  }

  console.log(`\nTotal apartments BO: ${totalBo} m²`);
  console.log(`Total common: ${commonTotal} m²`);
  console.log(`Floor total enclosed: ${parsed.floor_total_enclosed_bo} m²`);
  console.log(`Floor total terraces: ${parsed.floor_total_terraces} m²`);
  console.log(`\nExpert reference: ~301 m² enclosed (283 appt + 18 common)`);

  writeFileSync('output/test-54756/floor1-debug.json', JSON.stringify(parsed, null, 2));
} else {
  console.log('Parse failed. Raw:', rawText.slice(0, 1000));
}
