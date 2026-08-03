# SignalStack

Competition-grade agent for **Delphi: Agent Arena** (Gensyn).  
**1st place = highest P&L.** This repo is the trading machine + operator desk.

## Stack

```text
Polymarket odds + LLM calibration + anti-herd
        ↓
edge − DPM impact − slippage
        ↓
Kelly size → buy / sell inventory → redeem
        ↓
Operator desk (live board)
```

## Quick start

```bash
cp .env.example .env   # API key + wallet key (you fill secrets)
npm install
npm run setup-check    # verifies readiness without printing secrets
npm run desk           # http://127.0.0.1:4173
```

**Live desk:** https://signalstack.up.railway.app

| Command | Purpose |
|---------|---------|
| `npm run desk` | Operator UI + API |
| `npm run setup-check` | Checklist (API key / signer) |
| `npm run fund:status` | Sepolia + Gensyn balances |
| `npm run fund:bridge` | Bridge Sepolia ETH → Gensyn |
| `npm run fund:faucet` | Claim 1,000 testnet USDC |
| `npm run once` | One trading cycle |
| `npm run watch` | Headless loop |
| `npm run scan` | CLI edge preview |
| `npm test` | Unit tests |

Keep `SIGNALSTACK_DRY_RUN=1` until Aug 10. Full checklist: [`docs/runbook.md`](docs/runbook.md).

## Desk

Product control room for the competition agent:

- Big brand hero + one primary action: **Find edges now**
- Bankroll / best edge / floor at a glance
- Opportunity cards (not a dense spreadsheet)
- Setup checklist only when blocked
- Journal/logs tucked under Advanced

## Non-negotiables

- One registered wallet only  
- Never commit `.env`  
- Prefer markets settling before competition deadline  
- Strategy stays private — no need to open-source to win  
