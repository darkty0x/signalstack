# Competition runbook — SignalStack

Winning condition: **highest P&L** after settlement. This project exists to make every edge reliable.

## Before Aug 10

1. Register on DoraHacks as **SignalStack** with wallet `SIGNALSTACK_WALLET`.
2. Create `.env` from `.env.example` (never commit it).
3. Get testnet API key: https://delphi-api-access.gensyn.ai/
4. Fund Gensyn testnet ETH (faucet / Sepolia bridge).
5. Keep `SIGNALSTACK_DRY_RUN=1` and practice:
   - `npm run desk` → open http://127.0.0.1:4173
   - Click **Run cycle**, verify Edge board + journal
6. Optional: set `OPENAI_API_KEY` for LLM calibration layer.

## Aug 10 go-live

1. Confirm competition tokens landed on the registered wallet.
2. Set `SIGNALSTACK_DRY_RUN=0`.
3. `npm run desk` on a VPS that stays up 24/7.
4. Click **Start watch** (or `npm run watch`).
5. Desk should show **LIVE** + **WATCHING**.
6. Do not farm multiple wallets. Do not collude.

## Ops checks

| Check | Healthy |
|-------|---------|
| Mode pill | LIVE during competition |
| Bankroll | > 0 competition tokens |
| ETH | enough for gas |
| Edge board | ACTION rows when real edge exists |
| Journal | buys/sells/redeems appending |
| Watch | cycles incrementing |

## Kill switches

- Desk **Stop** or `SIGNALSTACK_DRY_RUN=1`
- Raise `SIGNALSTACK_MIN_EDGE` to trade less
- Lower `SIGNALSTACK_MAX_BET_FRACTION` to cut size

## After Aug 24

Leave watch running until positions redeem/liquidate. Final P&L includes settlement.
