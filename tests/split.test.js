import test from "node:test";
import assert from "node:assert/strict";

import {
  BUCKETS,
  sumCents,
  computeSplit,
  billsDueBeforeNextPay,
  buildTimeline,
  assignBillsToBlocks,
  validatePlan,
  derivePlanView,
} from "../split.js";

/* ---------- sumCents ---------- */

test("sumCents adds whole dollars and cents without float drift", () => {
  assert.equal(sumCents([32.5, 17.25, 0.3]), 5005);
});

test("sumCents handles strings, empty input, and junk safely", () => {
  assert.equal(sumCents(["1.00", 2, "$3.50"]), 650);
  assert.equal(sumCents([]), 0);
  assert.equal(sumCents(["banana", undefined, NaN]), 0);
});

test("sumCents ignores negative entries (safe-zero: negatives warn, never sum)", () => {
  assert.equal(sumCents([10, -4, 2.5]), 1250);
});

/* ---------- computeSplit ---------- */

test("equal 100% split adds up exactly to the paycheck", () => {
  const r = computeSplit(2000, { needs: 25, bills: 25, fun: 25, sinking: 25 });
  assert.equal(r.totalCents, 200000);
  assert.equal(r.allocatedCents, 200000);
  assert.equal(r.leftoverCents, 0);
  for (const b of BUCKETS) assert.equal(r.cents[b], 50000, b);
});

test("largest-remainder rounding keeps cents exact (1009 cents case)", () => {
  const r = computeSplit(10.09, { needs: 33.34, bills: 33.34, fun: 16.66, sinking: 16.66 });
  assert.equal(r.leftoverCents, 0);
  assert.equal(r.allocatedCents, 1009);
  assert.deepEqual(
    BUCKETS.map((b) => r.cents[b]),
    [337, 336, 168, 168]
  );
});

test("two-decimal dollar amount splits cleanly", () => {
  const r = computeSplit(1234.56, { needs: 50, bills: 30, fun: 10, sinking: 10 });
  assert.equal(r.cents.needs, 61728);
  assert.equal(r.cents.bills, 37037);
  assert.equal(r.cents.fun, 12346);
  assert.equal(r.cents.sinking, 12345);
  assert.equal(r.allocatedCents, 123456);
  assert.equal(r.leftoverCents, 0);
});

test("percentages under 100 leave the rest honestly unallocated", () => {
  const r = computeSplit(1000, { needs: 50, bills: 25, fun: 10, sinking: 5 });
  assert.equal(r.allocatedCents, 90000);
  assert.equal(r.leftoverCents, 10000);
  assert.equal(r.cents.fun, 10000);
});

test("percentages over 100 are capped at the paycheck total", () => {
  const r = computeSplit(100, { needs: 80, bills: 80, fun: 40, sinking: 40 });
  assert.equal(r.allocatedCents, 10000);
  assert.equal(r.leftoverCents, 0);
});

test("zero paycheck yields all-zero buckets (safe-zero is allowed)", () => {
  const r = computeSplit(0, { needs: 50, bills: 25, fun: 15, sinking: 10 });
  assert.equal(r.totalCents, 0);
  assert.equal(r.allocatedCents, 0);
  for (const b of BUCKETS) assert.equal(r.cents[b], 0, b);
});

test("negative paycheck yields all-zero buckets and is caught by validation", () => {
  const r = computeSplit(-50, { needs: 50, bills: 25, fun: 15, sinking: 10 });
  for (const b of BUCKETS) assert.equal(r.cents[b], 0, b);
  const warnings = validatePlan({ amount: -50, percents: { needs: 50, bills: 25, fun: 15, sinking: 10 } });
  assert.ok(warnings.some((w) => w.level === "danger" && /negative/i.test(w.message)));
});

test("negative and non-numeric percents clamp to zero, never inflate other buckets", () => {
  const r = computeSplit(100, { needs: -20, bills: 50, fun: "nope", sinking: 50 });
  assert.equal(r.cents.needs, 0);
  assert.equal(r.cents.bills, 5000);
  assert.equal(r.cents.fun, 0);
  assert.equal(r.cents.sinking, 5000);
});

test("tiny paycheck: one cent, one bucket gets it when percents sum to 100", () => {
  const r = computeSplit(0.01, { needs: 100 });
  assert.equal(r.cents.needs, 1);
  assert.equal(r.allocatedCents, 1);
});

test("tiny paycheck under 100% stays unallocated instead of magically splitting", () => {
  const r = computeSplit(0.01, { needs: 50 });
  assert.equal(r.cents.needs, 0);
  assert.equal(r.leftoverCents, 1);
});

test("string amounts and percents are accepted", () => {
  const r = computeSplit("600.00", { needs: "50", bills: "25", fun: "15", sinking: "10" });
  assert.equal(r.cents.needs, 30000);
  assert.equal(r.allocatedCents, 60000);
});

/* ---------- billsDueBeforeNextPay ---------- */

test("bills due before next pay are included; due on or after are not", () => {
  const bills = [
    { name: "Rent", amount: 800, dueDate: "2026-11-10" },
    { name: "Power", amount: 90.75, dueDate: "2026-11-13" },
    { name: "Next rent", amount: 800, dueDate: "2026-11-29" },
    { name: "No date", amount: 5 },
  ];
  const due = billsDueBeforeNextPay(bills, "2026-11-28");
  assert.deepEqual(due.map((b) => b.name), ["Rent", "Power"]);
});

test("a bill due exactly on next pay date belongs to the next check, not this one", () => {
  const bills = [{ name: "Phone", amount: 40, dueDate: "2026-11-28" }];
  assert.equal(billsDueBeforeNextPay(bills, "2026-11-28").length, 0);
});

test("missing next pay date returns nothing rather than guessing", () => {
  assert.deepEqual(billsDueBeforeNextPay([{ name: "x", amount: 1, dueDate: "2026-01-01" }], ""), []);
});

/* ---------- buildTimeline ---------- */

test("block size 0 gives one full-window block", () => {
  const blocks = buildTimeline("2026-11-13", "2026-11-27", 0);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { label: "Full window", start: "2026-11-13", end: "2026-11-27" });
});

test("weekly blocks cover the window end-exclusive with a clamped final block", () => {
  const blocks = buildTimeline("2026-11-13", "2026-11-27", 7);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0].start, "2026-11-13");
  assert.deepEqual(blocks[0].end, "2026-11-20");
  assert.deepEqual(blocks[1].start, "2026-11-20");
  assert.deepEqual(blocks[1].end, "2026-11-27");
  // No day is double-covered or skipped
  assert.ok(blocks[0].end <= blocks[1].start);
});

test("irregular window leaves a shorter final block", () => {
  const blocks = buildTimeline("2026-11-13", "2026-12-01", 7);
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[2], { label: "Block 3", start: "2026-11-27", end: "2026-12-01" });
});

test("inverted or missing dates produce no blocks", () => {
  assert.deepEqual(buildTimeline("2026-12-01", "2026-11-13", 7), []);
  assert.deepEqual(buildTimeline(null, "2026-11-27", 7), []);
  assert.deepEqual(buildTimeline("2026-11-13", "", 7), []);
});

test("same-day window (next pay before grace) yields no blocks", () => {
  assert.deepEqual(buildTimeline("2026-11-27", "2026-11-27", 7), []);
});

/* ---------- assignBillsToBlocks ---------- */

test("bills land in the block containing their due date", () => {
  const bills = [
    { name: "Rent", amount: 800, dueDate: "2026-11-14" },
    { name: "Power", amount: 90, dueDate: "2026-11-22" },
    { name: "Far future", amount: 5, dueDate: "2027-01-01" },
  ];
  const blocks = assignBillsToBlocks(bills, "2026-11-13", "2026-11-27");
  // Full-window block holds everything in range; out-of-range is clamped
  // to the nearest boundary block so nothing silently disappears.
  assert.deepEqual(blocks[0].bills.map((b) => b.name), ["Rent", "Power", "Far future"]);
});

/* ---------- validatePlan (safe-zero rules) ---------- */

const noPcts = { needs: 50, bills: 25, fun: 15, sinking: 10 };

test("empty amount is a gentle info prompt, not an error", () => {
  const w = validatePlan({ amount: "", percents: noPcts });
  assert.ok(w.some((x) => x.level === "info"));
  assert.ok(!w.some((x) => x.level === "danger"));
});

test("non-numeric amount warns", () => {
  const w = validatePlan({ amount: "abc", percents: noPcts });
  assert.ok(w.some((x) => x.level === "warn" && /not a valid number/.test(x.message)));
});

test("next pay date before pay date warns", () => {
  const w = validatePlan({ amount: 100, percents: noPcts, payDate: "2026-11-27", nextPayDate: "2026-11-13" });
  assert.ok(w.some((x) => /should be after/.test(x.message)));
});

test("percent sum under 100 warns with a left-to-allocate nudge", () => {
  const w = validatePlan({ amount: 100, percents: { needs: 50, bills: 25, fun: 15, sinking: 5 } });
  assert.ok(w.some((x) => /left to allocate/i.test(x.message)));
});

test("percent sum at 100 produces no leftover warning", () => {
  const w = validatePlan({ amount: 100, percents: noPcts });
  assert.ok(!w.some((x) => /left to allocate/i.test(x.message)));
});

test("sinking pots above their bucket warn as danger", () => {
  const w = validatePlan({
    amount: 100,
    percents: noPcts,
    pots: [{ name: "Tires", amount: 300 }],
  });
  assert.ok(w.some((x) => x.level === "danger" && /Sinking pots/.test(x.message)));
});

test("bills due before next pay above the bills bucket warn as danger", () => {
  const w = validatePlan({
    amount: 100,
    percents: noPcts,
    nextPayDate: "2026-11-28",
    bills: [{ name: "Rent", amount: 800, dueDate: "2026-11-14" }],
  });
  assert.ok(w.some((x) => x.level === "danger" && /bills bucket/.test(x.message)));
});

test("bills due before next pay inside the bucket pass cleanly", () => {
  const w = validatePlan({
    amount: 400,
    percents: { needs: 50, bills: 25, fun: 10, sinking: 15 },
    nextPayDate: "2026-11-28",
    bills: [
      { name: "Rent", amount: 80, dueDate: "2026-11-14" },
      { name: "Power", amount: 20, dueDate: "2026-11-20" },
    ],
  });
  assert.ok(!w.some((x) => x.level === "danger"), JSON.stringify(w));
});

test("negative bill amount warns as danger (safe-zero: 0 ok, negative not)", () => {
  const w = validatePlan({ amount: 100, percents: noPcts, bills: [{ name: "Refund?", amount: -5 }] });
  assert.ok(w.some((x) => x.level === "danger" && /negative amount/.test(x.message)));
});

test("zero bill amount is allowed silently", () => {
  const w = validatePlan({ amount: 100, percents: noPcts, bills: [{ name: "Paid off", amount: 0 }] });
  assert.ok(!w.some((x) => x.level === "danger"));
});

/* ---------- derivePlanView ---------- */

test("derivePlanView assembles totals, timeline, and warnings in one pass", () => {
  const view = derivePlanView({
    amount: 1000,
    percents: noPcts,
    payDate: "2026-11-13",
    nextPayDate: "2026-11-27",
    blockSizeDays: 7,
    bills: [{ name: "Rent", amount: 100, dueDate: "2026-11-14" }],
    pots: [{ name: "Tires", amount: 50 }],
  });
  assert.equal(view.split.cents.needs, 50000);
  assert.equal(view.dueBillsTotal, 10000);
  assert.equal(view.potsTotal, 5000);
  assert.equal(view.timeline.length, 2);
  assert.equal(view.timeline[0].billsTotal, 10000);
  assert.ok(view.hasWindow);
  assert.equal(view.warnings.length, 0);
});

test("derivePlanView with percents missing stays safe (nothing explodes)", () => {
  const view = derivePlanView({ amount: 1000 });
  assert.ok(Array.isArray(view.warnings));
  assert.ok(Array.isArray(view.timeline));
  assert.equal(view.split.allocatedCents, 0);
});
