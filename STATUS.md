# STATUS — Paycheck Split Planner

**Date:** 2026-11-07
**Author:** Asdale Dynamics, LLC (Dylan Asdale)

## What was built

A static, local-first webapp that splits an upcoming paycheck into four buckets:

1. **Needs** — daily must-haves (gas, groceries, medicine).
2. **Bills** — auto-focuses on bills due before the next pay date; warns (danger) when due bills out-spend the bills bucket.
3. **Fun** — guilt-free spending, planned on purpose.
4. **Sinking pots** — named pots funded across checks (with optional goals).

Core features, all working:

- Percentage split with **exact cent accounting** (largest-remainder method, so buckets always sum to the check when percents total 100%).
- Presets (Starter 50/25/15/10, Even 25s, Bills heavy 60/25/10/5) and honest **left-to-allocate** display for partial plans.
- **Editable date-block timeline**: pay-date to next-pay-date window rendered as editable blocks (full window / weekly / every 3 days / biweekly), each showing the bills landing inside it; labels and dates are user-editable and persist.
- **Safe-zero warnings**: zero/empty amounts are explicitly allowed and at most a gentle info note; only real overspend problems (negative paycheck, negative bill, buckets/pots overdrawn, dates inverted) raise warn/danger messages in plain language.
- **Local-first**: plan auto-saves to localStorage (debounced), export via clipboard or JSON download, "Start over" and "Clear saved data" buttons. No backend, no network calls, no secrets or personal data in any file.
- **Large-print friendly**: 19px base typography (24px in Large print mode), high contrast, labeled inputs, skip link, `aria-live` warning region, visible focus rings.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The app (single page) |
| `styles.css` | Large-print, high-contrast styling |
| `app.js` | DOM wiring; all persistence |
| `split.js` | Pure tested math: split, timeline, bills filtering, safe-zero validation |
| `tests/split.test.js` | 35 unit tests of the split math edge cases |
| `tests/dom.test.js` | 10 browser smoke tests (real `app.js` + real `index.html` in jsdom) |
| `README.md`, `LICENSE` | MIT, (c) 2026 Asdale Dynamics, LLC |

## How to run it

- Open `index.html` directly in a browser (works from `file://`), or
- `npm install && npm start` for a served copy.

## How to verify

```bash
npm install
npm test     # 45/45 passing
```

## Verification results (2026-11-07)

- `npm run check` (syntax check): **pass**
- `npm test`: **45 tests, 45 pass, 0 fail**
  - Unit: cents-exact splits, rounding cases ($10.09 → 337/336/168/168), sub-100% honesty, >100% capping, negative/zero/garbage inputs, date-boundary bills (a bill due exactly on next pay is excluded), timeline block covering/last-block clamping, inverting dates, all safe-zero validation rules.
  - DOM smoke: real UI boots, split table fills ($1600 → $800 needs etc.), bills route into the correct timeline block and update subtotals/warnings, presets apply, block rename persists, localStorage round-trip survives a simulated reload, remove-row works.
  - One real bug was caught and fixed by the smoke tests (dollar formatting treated cents as dollars → "80,000.00" instead of "800.00").

## Known gaps

- No manual "next paycheck rollover": each plan is one check; leftover-to-allocate is displayed but can't be automatically forwarded to the next split.
- No auto-suggestion that links bills % to the bills-due total (the matching % is shown; the user raises it manually).
- Timeline block edits that invert start/end dates aren't re-validated live (warnings cover paycheck-level problems; enter dates in order).
- No i18n; currency formatting is USD.
- No PWA/offline service worker (it already works fully offline from the file system).
