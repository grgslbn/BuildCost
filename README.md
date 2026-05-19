# BuildCost MVP

**AI-powered building reconstruction cost estimation for Belgian insurance companies.**

Upload a building plan → get a precise rebuild cost per m², powered by AI-discovered finishing-level parameters.

## Quick Start

```bash
# Clone
git clone https://github.com/[your-org]/buildcost.git
cd buildcost

# Install
npm install

# Set up environment
cp .env.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

# Run migrations on Supabase
# Copy docs/DATABASE_SCHEMA.sql into Supabase SQL editor and run

# Dev
npm run dev
```

## Project Structure

```
├── CLAUDE.md              ← Shared context for Claude Code sessions
├── docs/                  ← All project documentation
│   ├── PRD.md
│   ├── EXECUTION_PLAN.md
│   ├── SQM_CONTRACT.md   ← Interface contract between WS1 & WS2
│   ├── QQP_SEED_LIST.md
│   ├── DATABASE_SCHEMA.sql
│   └── ARCHITECTURE.md
├── prompts/               ← AI prompts (version controlled)
│   ├── sqm_extraction.md
│   └── qqp_extraction.md
└── src/                   ← Next.js application
```

## Team

- **Tiemen** — WS1: SQM Engine (surface area extraction)
- **Georges** — WS2: AI Pipeline (QQP discovery, cost calculation)

## Tech Stack

Next.js 14 · Supabase · Claude API · Vercel · Tailwind · shadcn/ui
