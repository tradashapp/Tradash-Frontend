# Phoenix live-trade CLI — migration phase 4

The first real Phoenix trade, run from a terminal rather than the app.

**Why not the UI.** `lib/venue/index.ts` still exports `BulkVenue`, and
`PhoenixVenue`'s write methods throw on purpose. Tapping Long in the app trades
on Bulk. Wiring Phoenix into the UI before a single order has ever settled would
mean debugging venue, adapter, hook and UI at once; this isolates the venue.

**Why the SDK is not a dependency here.** Delegate registration is the only flow
with no REST route, so it needs `@ellipsis-labs/rise`. Adding a large SDK to a
PWA bundle for a one-time setup step is a bad trade, so the CLI lives outside
the app and is run with `npx --package=@ellipsis-labs/rise`. Everything the app
itself does — building orders, asserting signers, submitting — uses
`lib/phoenix/*` with no SDK at all.

## Before running

Phoenix perps are **mainnet-only**. There is no devnet. Every step below moves
real money.

You need:
- `OWNER_SECRET` — base58 secret of the wallet that owns the trader account
- `DELEGATE_SECRET` — base58 secret of the session key (`keygen` makes one)
- A funded Phoenix trader account. `$1` is enough; SOL is the cheapest market to
  test with (1 lot ≈ $1.05, versus BTC's ≈ $7.74).
- **~0.01 SOL in the delegate wallet.** `SPONSOR_SECRET` is left unset for this
  phase, so the delegate pays its own transaction fees.

Never paste a secret into a chat, a commit, or a shell command that lands in
history. Use a file or an env var read from one.

## Why no sponsor here

Production sponsors fees from the backend (`feePayerService`), so users need no
SOL. That key is AES-encrypted for backend-only use, and decrypting it into a
shell env to run a test is how production keys leak — so this phase skips it.
The delegate pays instead, which changes nothing about what is being tested:
the delegate path is the thing under test, and the signer assertion accepts
both shapes (with a sponsor the slots are {sponsor writable, delegate readonly};
without one the delegate holds both). Sponsorship is exercised properly in
phase 5, where the backend signs as it does in production.

## Steps

0. **Generate a delegate key** — `keygen`, then fund it with ~0.01 SOL.
1. **Register the delegate** — one owner signature, once. After this the owner
   key is not needed to trade.
2. **Place a market order** — delegate signs, sponsor pays, owner signs nothing.
3. **Set TP/SL** — both legs in a single instruction.
4. **Close** — reduce-only back to flat.
5. **Verify** — the fill appears in `/v1/trader/{authority}/trades-history`, and
   `phoenix-index-dryrun.mts` in the backend turns it into the exact `trades`
   row the indexer would write.

Each step simulates before it sends (`simulate()` in `lib/phoenix/submit.ts`),
so a broken account list or insufficient collateral fails without spending
anything.

## What success proves

- The delegate path works end to end on chain, not just at build time
- One-tap survives: the owner wallet signs nothing after registration
- Phoenix's fills reconstruct into Tradash's trade rows correctly
- The sponsor model carries over from `feePayerService`

Only then is it worth wiring `PhoenixVenue` into the app (phase 5).
