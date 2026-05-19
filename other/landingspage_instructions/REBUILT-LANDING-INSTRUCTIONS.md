# ReBuilt Landing Page — Claude Code Instructions

> **For:** Tiemen (or whoever picks this up in Claude Code)
> **From:** Georges, via Claude.ai — 19 May 2026
> **Status:** Production HTML complete, needs conversion to deployable project

---

## What exists

A single self-contained HTML file: **`ReBuilt-Landing-Page.html`** (~1,100 lines).

It's a fully working PLO-first landing page for ReBuilt — the AI building cost estimation tool for Belgian insurers. Everything is inlined: CSS, JSX (via Babel standalone), i18n strings, sample data, animations.

### Locked-in design decisions

| Setting | Choice |
|---|---|
| Brand | **Forest** — Newsreader + Geist, bone/forest-green palette (`--accent: #2F5D3A`, `--bg: #FBFAF5`) |
| Hero layout | **Cards** — animated estimate cards building up progressively (villa → apartment → townhouse loop) |
| Demo style | **Upload** — drag-drop file upload → 4-step simulated AI processing → results with email gate → room-by-room report |
| Languages | **EN / FR / NL** — toggle in nav, full i18n for all sections |
| Tweaks panel | **Stripped** — this is a public landing page, not an internal demo |

### Page sections (in order)

1. **Nav** — sticky, glassmorphism, logo + links + lang toggle + CTA button
2. **Hero** — badge, 3-line headline, sub-copy, two CTAs, proof bar. Right column: `AnimatedHeroCards` component
3. **Trust bar** — 6 placeholder logo wordmarks (AssurBel, Cosmos Mutual, etc.)
4. **Demo** — upload zone with drag-drop, simulated 4-step processing, result display, email gate, detailed room-by-room report
5. **Features** — 6-card grid (m², AI, €, ↻, ⌂, 📄)
6. **How it works** — 3 step cards with detail blocks
7. **Belgium** — bullet list + ABEX finishing coefficient table
8. **FAQ** — 6-item accordion
9. **CTA** — dark section, beta signup form (company, email, volume, region)
10. **Footer** — brand, tagline, links, copyright

### What's simulated / placeholder

- **Demo processing** is client-side only — picks from 3 pre-baked sample datasets (villa Ixelles, apartment Gent, townhouse Liège). The `beginProcessing` function is the one to replace with real API calls later.
- **Email gate** just toggles a "thanks" message, no actual email sent.
- **CTA form** toggles a confirmation, no backend submission.
- **Trust logos** are fake company names as styled text, not real logos.

---

## Task: Convert to a deployable Vite + React project

### Recommended stack

```
Vite + React (static SPA)
├── No backend needed for the landing page
├── Deploy to Railway (static site) or Vercel
├── GitHub repo: new repo, e.g. `rebuilt-landing`
└── Domain: rebuilt.be or subdomain of existing
```

### Step-by-step

#### 1. Scaffold the project

```bash
npm create vite@latest rebuilt-landing -- --template react
cd rebuilt-landing
npm install
```

#### 2. Extract from the HTML file

The standalone HTML has everything inline. You need to split it into:

```
rebuilt-landing/
├── public/
│   └── favicon.svg          # create a simple ReBuilt favicon
├── src/
│   ├── main.jsx              # ReactDOM.createRoot + <App/>
│   ├── App.jsx               # main App component (language state, scroll effects, section composition)
│   ├── styles.css             # all CSS — copy the <style> block as-is
│   ├── i18n.js               # the I18N object — export it as ESM
│   ├── components/
│   │   ├── Nav.jsx
│   │   ├── Hero.jsx
│   │   ├── AnimatedHeroCards.jsx   # the card animation component
│   │   ├── TrustBar.jsx
│   │   ├── UploadDemo.jsx          # upload + processing + results + email gate + detailed report
│   │   ├── Features.jsx
│   │   ├── HowItWorks.jsx
│   │   ├── Belgium.jsx
│   │   ├── FAQ.jsx
│   │   ├── CTA.jsx
│   │   └── Footer.jsx
│   └── data/
│       └── samplePlans.js     # SAMPLE_PLAN_DATA + ANIM_CARDS constants
├── index.html
├── package.json
├── vite.config.js
└── CLAUDE.md
```

#### 3. Key conversion notes

**Remove Babel standalone.** The HTML uses `<script type="text/babel">` with CDN Babel. Vite handles JSX natively — just use `.jsx` files with standard imports.

**Remove CDN React.** Replace with `import React from 'react'` etc. Vite bundles it.

**Google Fonts.** Keep the Google Fonts link in `index.html` `<head>`. Only load these three families (the Forest brand ones):
```html
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&family=Geist:wght@300..700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

**CSS variables.** The Forest tokens are hardcoded in `:root` — no brand switching needed. Copy the CSS as-is from the `<style>` block.

**i18n.** Convert from `window.REBUILT_I18N` to a proper ESM export:
```js
// src/i18n.js
export const I18N = { en: { ... }, fr: { ... }, nl: { ... } };
```

**AnimatedHeroCards.** This is the most complex component — it has internal state with tick-based animation, upload bar progress, and card reveal levels. Copy it faithfully; the timing constants at the top (`REVEAL_TICK`, `UPLOAD_BAR`, `HOLD_END`, `BETWEEN`) control the feel.

**UploadDemo.** Has three states: `idle` → `processing` → `results`. The `beginProcessing` function picks sample data based on filename keywords. The email gate reveals `DetailedReport` with room list + cost breakdown + animated finishing gauge.

#### 4. Deploy

**Option A — Railway (static):**
```bash
# In vite.config.js
export default { build: { outDir: 'dist' } }

# railway.json
{
  "build": { "builder": "NIXPACKS" },
  "deploy": { "startCommand": "npx serve dist -s -l 3000" }
}
```
Add `serve` as a dependency or use Railway's static site builder.

**Option B — Vercel (zero-config):**
```bash
vercel
# Vite is auto-detected, zero config needed
```

#### 5. CLAUDE.md for the repo

```markdown
# ReBuilt Landing Page

## What this is
Public-facing landing page for ReBuilt — AI-powered building reconstruction cost estimation for Belgian insurance companies.

## Stack
- Vite + React (static SPA, no backend)
- CSS custom properties (Forest brand theme hardcoded)
- i18n: EN/FR/NL, all strings in src/i18n.js

## Design decisions (locked)
- Brand: Forest (Newsreader + Geist, #2F5D3A accent, #FBFAF5 bg)
- Hero: Cards layout with AnimatedHeroCards
- Demo: Upload style with email gate
- No tweaks panel — this is a production page

## Key components
- AnimatedHeroCards: tick-based animation cycling through 3 estimate cards
- UploadDemo: file upload → simulated processing → results → email gate → detailed report
- All sections: Nav, Hero, TrustBar, Demo, Features, HowItWorks, Belgium, FAQ, CTA, Footer

## Sample data
3 pre-baked datasets in src/data/samplePlans.js:
- Villa Ixelles (186.4m², Comfort, €350K)
- Apartment Gent (124.8m², Luxury, €243K)
- Townhouse Liège (98.2m², Standard, €133K)

## What's simulated
- Demo "AI processing" is client-side only (picks from sample data)
- Email gate just toggles UI state, no actual email
- CTA form is client-side only, no backend
- Trust logos are placeholder text

## Future work (don't do yet)
- Wire demo to real ReBuilt API when available
- Real form submission (email service / API endpoint)
- Real trust logos when we have beta clients
- Analytics (PostHog or similar)
```

---

## Design tokens reference (Forest brand)

```css
--bg: #FBFAF5
--bg-deep: #F0EEE5
--bg-card: #FFFFFF
--ink: #161A14
--ink-soft: #4A5045
--ink-muted: #8C9088
--accent: #2F5D3A
--accent-light: #E1ECDD
--accent-deep: #1F4128
--accent-ink: #FBFAF5
--border: #E5E3D9
--green: #2F5D3A
--blue: #2C4F6E
--yellow: #8B6A14
--font-display: 'Newsreader'
--font-body: 'Geist'
--font-mono: 'JetBrains Mono'
```

---

## Source file

The production HTML file is attached: **`ReBuilt-Landing-Page.html`**

Open it in a browser to see exactly what it should look like. All code, styles, i18n strings, and sample data are in that one file — it's the single source of truth for the conversion.

---

## Context

- The design originated from a Claude Design handoff bundle (prototyped in claude.ai/design)
- The original prototype had 6 brand directions, 3 hero layouts, 3 demo styles, and a tweaks panel — all stripped for production
- Reference app that inspired the layout: `https://immo-app-production-673e.up.railway.app`
- Audience: insurance company decision-makers (claims directors, ops leads) in Belgium
