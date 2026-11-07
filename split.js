/**
 * split.js — pure paycheck-split math, date-block timeline, and validation.
 *
 * No DOM, no storage, no dependencies. Used by app.js (browser, ES module)
 * and by tests/split.test.js (Node, via ESM import).
 *
 * Money is handled in whole cents to avoid float drift. Inputs may be
 * numbers or numeric strings; outputs are integers (cents) unless noted.
 */

export const BUCKETS = ["needs", "bills", "fun", "sinking"];

const toCents = (value) => {
  const n = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

const toNonNegInt = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
};

/**
 * Sum of money-like values in cents; null-safe (nulls/NaN count as 0).
 */
export function sumCents(values) {
  return values.reduce((total, v) => {
    const c = toCents(v);
    return total + (c === null || c < 0 ? 0 : c);
  }, 0);
}

/**
 * Split a paycheck amount (dollars) across bucket percentages.
 *
 * Uses the largest-remainder method so the cent amounts always add up
 * exactly to the paycheck total, even when percentages produce fractions
 * of a cent. Percentages may not sum to 100; whatever is left over simply
 * stays unallocated (the UI surfaces it as "left to allocate").
 *
 * @param {number|string} amountDollars paycheck amount
 * @param {Record<string, number|string>} percents map of bucket -> percent
 * @returns {{ totalCents: number, allocatedCents: number, leftoverCents: number,
 *             cents: Record<string, number>, percents: Record<string, number> }}
 */
export function computeSplit(amountDollars, percents) {
  const totalCents = toCents(amountDollars) ?? 0;
  const clamped = {};
  for (const bucket of BUCKETS) {
    // Note: negative percents are user typos — clamp to 0 so they cannot
    // silently inflate other buckets.
    const p = Number(percents?.[bucket]);
    clamped[bucket] = Number.isFinite(p) && p > 0 ? p : 0;
  }

  const cents = {};
  let allocated = 0;
  if (totalCents <= 0) {
    for (const bucket of BUCKETS) cents[bucket] = 0;
    return {
      totalCents,
      allocatedCents: 0,
      leftoverCents: totalCents,
      cents,
      percents: clamped,
    };
  }

  const floorCents = {};
  const remainderRank = {};
  const pctSum = BUCKETS.reduce((s, b) => s + clamped[b], 0);
  // Budget each bucket's floor share from the paycheck total so percents
  // summing over 100% can never allocate more than the paycheck itself.
  let budget = totalCents;
  for (const bucket of BUCKETS) {
    const exact = (totalCents * clamped[bucket]) / 100;
    const floored = Math.floor(exact);
    floorCents[bucket] = floored;
    remainderRank[bucket] = exact - floored;
    cents[bucket] = Math.min(floored, budget);
    budget -= cents[bucket];
  }
  let assigned = BUCKETS.reduce((s, b) => s + cents[b], 0);

  // When the percents genuinely add up to 100%, flooring can shave off a few
  // cents; give them back to the buckets with the largest fractional
  // remainders so the split always sums to the exact paycheck total.
  // When percents intentionally sum to less than 100%, that remainder stays
  // honestly "left to allocate" — it is a user choice, not rounding noise.
  const wantsFullSplit = Math.round(pctSum * 100) === 10000;
  if (wantsFullSplit) {
    const byRemainder = [...BUCKETS].sort((a, b) => remainderRank[b] - remainderRank[a]);
    for (const bucket of byRemainder) {
      if (assigned >= totalCents) break;
      cents[bucket] += 1;
      assigned += 1;
    }
  }

  return {
    totalCents,
    allocatedCents: assigned,
    leftoverCents: totalCents - assigned,
    cents,
    percents: clamped,
  };
}

/**
 * Filter bills to those due strictly before the "next pay date" — the ones
 * this paycheck has to cover first.
 *
 * @param {Array<{name: string, amount: number|string, dueDate: string}>} bills
 * @param {string} nextPayDateISO ISO date "YYYY-MM-DD"
 */
export function billsDueBeforeNextPay(bills, nextPayDateISO) {
  if (!nextPayDateISO) return [];
  const next = new Date(`${nextPayDateISO}T00:00:00`);
  return (bills || []).filter((b) => {
    if (!b?.dueDate) return false;
    const due = new Date(`${b.dueDate}T00:00:00`);
    return !Number.isNaN(due.getTime()) && due < next;
  });
}

/**
 * Group bills into date blocks on the timeline between payDate and nextPayDate.
 * A bill whose dueDate falls outside the [payDate, nextPay) window still shows
 * up in the nearest boundary block so nothing silently disappears.
 */
export function assignBillsToBlocks(bills, payDateISO, nextPayDateISO) {
  const blocks = buildTimeline(payDateISO, nextPayDateISO, 0);
  const result = blocks.map((b) => ({ ...b, bills: [] }));
  for (const bill of bills || []) {
    if (!bill?.dueDate) continue;
    const due = new Date(`${bill.dueDate}T00:00:00`);
    if (Number.isNaN(due.getTime())) continue;
    let idx = result.findIndex(
      (block) => due >= new Date(`${block.start}T00:00:00`) && due < new Date(`${block.end}T00:00:00`)
    );
    if (idx === -1) idx = due < new Date(`${blocks[0].start}T00:00:00`) ? 0 : result.length - 1;
    result[idx].bills.push(bill);
  }
  return result;
}

/**
 * Build an editable timeline of date blocks between the upcoming pay date
 * and the next pay date.
 *
 * @param {string|null} payDateISO upcoming paycheck date
 * @param {string|null} nextPayDateISO the following paycheck date
 * @param {number} blockSizeDays 0 = a single block spanning the full window
 * @returns {Array<{label: string, start: string, end: string}>} end-exclusive ISO dates
 */
export function buildTimeline(payDateISO, nextPayDateISO, blockSizeDays = 0) {
  if (!payDateISO || !nextPayDateISO) return [];
  const start = new Date(`${payDateISO}T00:00:00`);
  const end = new Date(`${nextPayDateISO}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return [];

  const size = toNonNegInt(blockSizeDays);
  if (size === 0) {
    return [{ label: "Full window", start: payDateISO, end: nextPayDateISO }];
  }

  const blocks = [];
  let cursor = new Date(start);
  let index = 0;
  while (cursor < end) {
    const blockStart = cursor.toISOString().slice(0, 10);
    const blockEnd = new Date(cursor.getTime() + size * 86400000);
    const isLast = blockEnd >= end;
    const clampedEnd = isLast ? end : blockEnd;
    const endISO = clampedEnd.toISOString().slice(0, 10);
    const dayN = Math.round((new Date(end) - new Date(start)) / 86400000);
    blocks.push({
      label: isLast && size >= dayN ? "Full window" : `Block ${index + 1}`,
      start: blockStart,
      end: endISO,
    });
    cursor = new Date(clampedEnd.getTime());
    index += 1;
  }
  return blocks;
}

/**
 * Safe-zero validation: zero is fine, negatives and overspending warn.
 * Never throws; always returns a warnings list (possibly empty).
 *
 * @param {object} plan full plan state
 * @returns {Array<{level: "warn"|"danger", message: string}>}
 */
export function validatePlan(plan) {
  const warnings = [];
  const amountCents = toCents(plan?.amount);

  if (plan?.amount === "" || plan?.amount === null || plan?.amount === undefined) {
    warnings.push({ level: "info", message: "No paycheck amount entered yet." });
  } else if (amountCents === null) {
    warnings.push({ level: "warn", message: "Paycheck amount is not a valid number." });
  } else if (amountCents < 0) {
    warnings.push({
      level: "danger",
      message: "Paycheck amount is negative. A paycheck can't be negative — safe-zero means zero is okay, not less.",
    });
  } else if (amountCents === 0) {
    warnings.push({ level: "warn", message: "Paycheck amount is zero. Nothing to split — that's allowed, just check it's right." });
  }

  if (plan?.payDate && plan?.nextPayDate && plan.nextPayDate <= plan.payDate) {
    warnings.push({
      level: "warn",
      message: "Next pay date should be after the upcoming pay date.",
    });
  }

  const split = computeSplit(plan?.amount ?? 0, plan?.percents ?? {});
  if (split.totalCents > 0) {
    const pctSum = BUCKETS.reduce((s, b) => s + split.percents[b], 0);
    if (split.leftoverCents > 0 && Math.abs(pctSum - 100) > 0.01) {
      warnings.push({
        level: "warn",
        message:
          `Left to allocate: ${fmt(split.leftoverCents)} of ${fmt(split.totalCents)} ` +
          `— your percentages don't add up to 100% (${round2(pctSum)}%). Nothing is lost, it just isn't planned yet.`,
      });
    }
    // Sinking pots above their assigned bucket can quietly overdraw the plan.
    const sinkingAllocated = sumCents((plan?.pots || []).map((p) => p.amount));
    if (sinkingAllocated > split.cents.sinking) {
      warnings.push({
        level: "danger",
        message: `Sinking pots add up to ${fmt(sinkingAllocated)} but the sinking bucket is only ${fmt(split.cents.sinking)}.`,
      });
    }
  }

  const bills = plan?.bills || [];
  for (const bill of bills) {
    const c = toCents(bill?.amount);
    if (c === null && (bill?.amount ?? "") !== "") {
      warnings.push({ level: "warn", message: `Bill "${bill?.name || "unnamed"}" has an amount that isn't a number.` });
    } else if (c !== null && c < 0) {
      warnings.push({ level: "danger", message: `Bill "${bill?.name || "unnamed"}" has a negative amount (safe-zero: bills can be zero, not negative).` });
    }
  }

  if (plan?.nextPayDate) {
    const dueBills = billsDueBeforeNextPay(bills, plan.nextPayDate);
    const dueTotal = sumCents(dueBills.map((b) => b.amount));
    if (dueTotal > split.cents.bills) {
      warnings.push({
        level: "danger",
        message:
          `Bills due before next pay total ${fmt(dueTotal)} but the bills bucket is only ${fmt(split.cents.bills)}. ` +
          `Raise the bills % or move a bill.`,
      });
    }
  }

  return warnings;
}

/**
 * All-in-one derived view for the UI.
 */
export function derivePlanView(plan) {
  const split = computeSplit(plan?.amount ?? 0, plan?.percents ?? {});
  const bills = plan?.bills || [];
  const dueBills = plan?.nextPayDate ? billsDueBeforeNextPay(bills, plan.nextPayDate) : [];
  const dueBillsTotal = sumCents(dueBills.map((b) => b.amount));
  const blocks = plan?.blocks?.length
    ? plan.blocks
    : buildTimeline(plan?.payDate, plan?.nextPayDate, plan?.blockSizeDays ?? 0);
  const timeline = blocks.map((block) => {
    const blockStart = new Date(`${block.start}T00:00:00`);
    const blockEnd = new Date(`${block.end}T00:00:00`);
    const inBlock = bills.filter((b) => {
      if (!b?.dueDate) return false;
      const due = new Date(`${b.dueDate}T00:00:00`);
      if (Number.isNaN(due.getTime())) return false;
      return due >= blockStart && due < blockEnd;
    });
    return { ...block, bills: inBlock, billsTotal: sumCents(inBlock.map((b) => b.amount)) };
  });
  const potsTotal = sumCents((plan?.pots || []).map((p) => p.amount));
  return {
    split,
    dueBills,
    dueBillsTotal,
    timeline,
    potsTotal,
    warnings: validatePlan(plan),
    hasWindow: Boolean(plan?.payDate && plan?.nextPayDate && plan.nextPayDate > plan.payDate),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function fmt(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
