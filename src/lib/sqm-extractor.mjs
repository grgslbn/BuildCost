import { readFileSync } from 'fs';

const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

const COST_PER_MTOK = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
};

function loadPrompts() {
  const raw = readFileSync('prompts/sqm_extraction.md', 'utf-8').replace(/\r\n/g, '\n');
  const blocks = [...raw.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1].trim());
  return { system: blocks[0], user: blocks[1] };
}

export function resolveModel(name) {
  return MODELS[name] || name;
}

export async function extractSqm(images, modelId, opts = {}) {
  const apiKey = opts.apiKey || process.env.BUILDCOST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No API key (set BUILDCOST_ANTHROPIC_KEY or ANTHROPIC_API_KEY)');

  const { system, user } = loadPrompts();
  const content = [];

  // Context about the images
  let contextText = user;
  if (opts.context) {
    contextText = opts.context + '\n\n' + user;
  }
  content.push({ type: 'text', text: contextText });

  // Add images
  let totalBytes = 0;
  for (const img of images) {
    const imageData = typeof img.png === 'string'
      ? readFileSync(img.png)
      : img.png;
    totalBytes += imageData.length;

    content.push({ type: 'text', text: `\n--- Image: ${img.name || img.label} ---` });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: imageData.toString('base64')
      }
    });
  }

  const startTime = Date.now();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const elapsed = Date.now() - startTime;
  const inputTokens = result.usage?.input_tokens || 0;
  const outputTokens = result.usage?.output_tokens || 0;

  const costs = COST_PER_MTOK[modelId] || { input: 3, output: 15 };
  const costUsd = (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;

  const rawText = result.content[0]?.text || '';

  let extraction = null;
  try {
    const jsonStr = rawText.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    extraction = JSON.parse(jsonStr);
  } catch (e) {
    // Return raw text if JSON parse fails
  }

  return {
    extraction,
    rawText,
    modelId,
    inputTokens,
    outputTokens,
    processingTimeMs: elapsed,
    costUsd: Math.round(costUsd * 10000) / 10000,
    imageSizeMb: Math.round(totalBytes / 1024 / 1024 * 10) / 10,
    imageCount: images.length
  };
}
