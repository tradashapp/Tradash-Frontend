# Tradash — Frontend 

Mobile-first, tap-to-trade perpetuals UI. The homepage **is** the trading screen.     
     
- **Next.js 16** (App Router) · React 19 · TypeScript        
- **Tailwind CSS** (dark-first tokens) · **Framer Motion** (animations)   
- **Redux Toolkit** — six isolated slices (`market`, `price`, `position`, `user`, `trading`, `settings`)
- **Privy** — wallet connect / master-account auth  
- **Hugeicons** — all UI icons 
- **Custom canvas chart engine** (no chart library) — Phase 1
- Price from the **MagicBlock oracle** (direct ER account reads); execution + live account
  data from **Bulk Exchange** (REST + account WS). Our revenue: Bulk **builder codes**. 

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in Privy id, Bulk URLs, builder recipient, etc.
npm run dev
```

## Structure

```
app/           App Router — page.tsx is the trading screen; providers.tsx = Redux + Privy
components/    chart · background · trade · layout · sheets
lib/           bulk/ · oracle/ · chart/ · privy/ · config.ts · markets.ts
store/         index.ts + slices/ + hooks.ts + persist.ts
hooks/         useLivePrice, usePosition, useBalance, useAgentWallet (Phase 1+)
types/         shared domain types
```

See `../PLAN.md` and `../track.md` for the full plan and phase progress.
