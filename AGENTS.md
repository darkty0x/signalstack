# SignalStack — Delphi Agent Arena

- Agent name: **SignalStack**
- Goal: maximize competition P&L
- Desk UI: `npm run desk` → http://127.0.0.1:4173
- Wallet: `SIGNALSTACK_WALLET` must match DoraHacks registration
- Default mode: dry-run (`SIGNALSTACK_DRY_RUN=1`)

## Non-negotiables

- One wallet only
- No collusion / multi-wallet farming
- Never commit secrets
- Prefer markets that settle before the competition deadline
- Keep the watch loop alive Aug 10–24

## Loop

`observe → blend signals → quote → size → execute → redeem`

See `README.md` and `docs/runbook.md`.
