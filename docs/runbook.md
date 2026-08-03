# Competition runbook — SignalStack

Winning condition: **highest P&L** after settlement. This project exists to make every edge reliable.

## Before Aug 10

1. Register on DoraHacks as **SignalStack** with wallet `SIGNALSTACK_WALLET`.
2. Create `.env` from `.env.example` (never commit it).
3. Get testnet API key: https://delphi-api-access.gensyn.ai/
4. **Fund gas + practice USDC** (see [Funding](#funding-gensyn-testnet) below).
5. Keep `SIGNALSTACK_DRY_RUN=1` and practice:
   - Desk: https://signalstack.up.railway.app (or `npm run desk`)
   - Click **Find edges**, verify Opportunities + journal
6. Optional: set `OPENAI_API_KEY` for LLM calibration layer.

## Funding (Gensyn testnet)

Wallet must have **Gensyn ETH** (gas) before any trade or USDC faucet claim.

```bash
npm run fund:status
```

### Step 1 — Sepolia ETH (manual faucet)

1. Open https://cloud.google.com/application/web3/faucet/ethereum/sepolia
2. Paste registered address: `0x67df2320690a7870c20105662d525a567254b7d5`
3. Claim Sepolia ETH
4. Re-check: `npm run fund:status` → Sepolia ETH > 0

### Step 2 — Bridge to Gensyn

```bash
npm run fund:bridge -- 0.01
```

Wait a few minutes. Gensyn deposits show under **Internal txns** on  
https://gensyn-testnet.explorer.alchemy.com/address/0x67df2320690a7870c20105662d525a567254b7d5

### Step 3 — Claim mock USDC (practice bankroll)

```bash
npm run fund:faucet
```

Each call mints **1,000 USDC**. Competition tokens on Aug 10 are separate — still useful for dry practice now.

## Aug 10 go-live

1. Confirm competition tokens landed on the registered wallet (`npm run fund:status` / desk Bankroll).
2. Keep `SIGNALSTACK_DRY_RUN=0` on Railway (already live if set).
3. Desk stays up 24/7 on Railway: https://signalstack.up.railway.app
4. Click **Start watch** (or `npm run watch`).
5. Header should show green live dot + **testnet** + watching eye icon.
6. Do not farm multiple wallets. Do not collude.

## Ops checks

| Check | Healthy |
|-------|---------|
| Live dot | green (not dry amber) during competition |
| Bankroll | > 0 competition tokens |
| ETH | enough Gensyn gas |
| Opportunities | Ready rows when real edge exists |
| Journal | buys/sells/redeems appending |
| Watch | eye icon visible; cycles incrementing |

## Kill switches

- Desk **Stop** or `SIGNALSTACK_DRY_RUN=1`
- Raise `SIGNALSTACK_MIN_EDGE` to trade less
- Lower `SIGNALSTACK_MAX_BET_FRACTION` to cut size

## After Aug 24

Leave watch running until positions redeem/liquidate. Final P&L includes settlement.
