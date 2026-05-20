import { readFileSync } from 'fs';

const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
  // legacy aliases
  'sonnet-4': 'claude-sonnet-4-20250514',
  'opus-4': 'claude-opus-4-20250514',
};

const COST_PER_MTOK = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-7': { input: 15.00, output: 75.00 },
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

    const path = typeof img.png === 'string' ? img.png : '';
    const mediaType = path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg')
      ? 'image/jpeg'
      : 'image/png';

    content.push({ type: 'text', text: `\n--- Image: ${img.name || img.label} ---` });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: imageData.toString('base64')
      }
    });
  }

  const startTime = Date.now();

  const timeoutMs = opts.timeoutMs || 300_000;
  const useThinking = opts.thinking !== false; // default ON
  const thinkingBudget = opts.thinkingBudget || 10000;

  const requestBody = {
    model: modelId,
    max_tokens: useThinking ? thinkingBudget + 16384 : 16384,
    system,
    messages: [{ role: 'user', content }]
  };

  if (useThinking) {
    requestBody.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
    // thinking requires temperature=1
  } else {
    requestBody.temperature = 0;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(timeoutMs)
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

  // Find the text block — thinking responses have thinking + text blocks
  const textBlock = result.content?.find(b => b.type === 'text');
  const thinkingBlock = result.content?.find(b => b.type === 'thinking');
  const rawText = textBlock?.text || '';
  const thinkingText = thinkingBlock?.thinking || '';

  let extraction = null;
  try {
    // Try 1: direct parse (clean JSON response)
    extraction = JSON.parse(rawText);
  } catch {
    try {
      // Try 2: strip markdown code fences
      const fenced = rawText.match(/```json?\s*\n([\s\S]*?)\n```/);
      if (fenced) {
        extraction = JSON.parse(fenced[1]);
      } else {
        // Try 3: find first { and last } — model added prose around JSON
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          extraction = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
        }
      }
    } catch {
      // Return raw text if all parsing fails
    }
  }

  return {
    extraction,
    rawText,
    thinkingText,
    thinkingEnabled: useThinking,
    modelId,
    inputTokens,
    outputTokens,
    processingTimeMs: elapsed,
    costUsd: Math.round(costUsd * 10000) / 10000,
    imageSizeMb: Math.round(totalBytes / 1024 / 1024 * 10) / 10,
    imageCount: images.length
  };
}
