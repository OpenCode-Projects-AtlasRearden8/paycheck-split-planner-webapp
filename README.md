# Paycheck Split Planner

A static, local-first webapp that splits your **upcoming paycheck** into four buckets — **needs**, **bills due before your next pay**, **fun**, and **sinking pots** — with an editable date-block timeline and *safe-zero* warnings when amounts go negative.

Made by [Asdale Dynamics, LLC](https://dylanasdale.github.io) — plain-English tools that are easy to start, easy to see, and never condescending. This is budgeting math, **not financial advice**.

## Why a paycheck planner?

Envelopes fill a whole month. Sinking-fund trackers chase long-term goals. But most of us live **one paycheck at a time** — and the hard part is answering one question: *"This check comes in on Friday. Where does every dollar go?"*

This app answers exactly that:

- **Needs** — gas, groceries, medicine, daily must-haves.
- **Bills** — everything due between this check and the next one, in priority order.
- **Fun** — guilt-free spending, on purpose.
- **Sinking pots** — save across checks for known-but-not-monthly stuff (tires, holidays, vet visits).

## Features

- **Percentage split** — set your own buckets, or start from a preset. Whatever doesn't total 100% stays honestly displayed as **left to allocate**; cents are distributed so the buckets sum to your check exactly.
- **Bills due before next pay** — your bills are automatically grouped by whether they fall inside this check's window, and the app warns (danger) if they out-spend the bills bucket.
- **Editable date-block timeline** — the span between pay dates becomes editable blocks (full window, weekly, every 3 days, biweekly). Rename blocks, shift dates, and see which bills land in each.
- **Safe-zero warnings** — an empty or zero plan is *fine*; nothing panics over zeros. Only real overspend problems (negative amounts, buckets overdrawn, pots exceeding their bucket) get flagged, in plain language.
- **Large-print friendly** — generous font sizes everywhere plus a one-click **Large print** mode; high-contrast, keyboard-navigable, screen-reader labeled.
- **Local-first** — your plan lives in your browser's localStorage. **No backend, no accounts, no network calls.** Export your plan as JSON (clipboard or file) whenever you want a backup.

## How to run it

No build step. Just open the folder:

1. **Simplest:** double-click `index.html` (or open it in any modern browser). Everything works from `file://`.
2. **Served locally (nicer for editing):**
   ```bash
   npm install
   npm start        # runs a tiny static server
   ```
3. Save state persists automatically per browser. "Clear saved data" or "Start over" removes it from that browser only.

## Tests

Split math (rounding, edge cases, safe-zero rules) and a full browser smoke test of the real UI in jsdom:

```bash
npm install
npm test
```

## Who it's for

Anyone paid on a repeating single check — nurses, shift workers, hourly workers — plus anyone who wants ADHD-friendly, low-energy budgeting: one screen, big text, no dashboards, no judgment.

## Tech

Plain HTML + CSS + vanilla ES modules. Dependencies are dev-only (`jsdom` for tests). The core math lives in `split.js` — pure, tested, reusable.

## Distinct from our other budgeting tools

| Tool | Focus |
|------|-------|
| **paycheck-split-planner-webapp** (this) | One upcoming paycheck at a time, bills-due-first |
| envelope-budget-webapp | Whole-month envelopes |
| sinking-fund-tracker | Long-term goal pots only |

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Asdale Dynamics, LLC.
