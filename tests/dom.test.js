/**
 * dom.test.js — browser smoke tests: runs the real app.js against the real
 * index.html in jsdom, then drives it like a user would and checks what a
 * user would see. Catches broken selectors and wiring that unit tests can't.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const { JSDOM } = await import("jsdom");

// index.html references app.js as an ES module; jsdom can't execute module
// scripts, so strip the tag and load app.js ourselves against the DOM.
const html = readFileSync(path.join(root, "index.html"), "utf8").replace(
  /<script[^>]*app\.js[^>]*><\/script>/,
  ""
);

const dom = new JSDOM(html, { url: "http://localhost/" });

globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
try {
  globalThis.navigator = dom.window.navigator;
} catch {
  /* newer Node has a locked global navigator; fine for this smoke test */
}
globalThis.confirm = () => true;
globalThis.window = dom.window;

// Import the real app. It wires listeners and renders on load.
await import(new URL("file://" + path.join(root, "app.js")).href);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const input = (el) => {
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
const change = (el) => {
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
};
const click = (el) => el.click();
const tick = () => new Promise((r) => setTimeout(r, 350));

test("app boots: split inputs, empty-list prompts, and an info warning render", () => {
  assert.equal($$("#split-grid input[data-pct]").length, 4);
  assert.match($("#warnings li").textContent, /no paycheck amount/i);
  assert.match($("#bills-rows .empty-note").textContent, /no bills yet/i);
  assert.match($("#timeline-empty").textContent, /set both pay dates/i);
});

test("entering a paycheck fills the split table dollar amounts", () => {
  $("#amount").value = "1600";
  input($("#amount"));
  assert.equal($("#leftover").textContent, "$0.00");
  const rows = $$("#split-totals tr");
  assert.equal(rows[0].textContent.includes("$800.00") && rows[0].textContent.includes("50%"), true);
});

test("pay dates + weekly blocks render an editable timeline with day counts", () => {
  $("#payDate").value = "2026-11-13";
  change($("#payDate"));
  $("#nextPayDate").value = "2026-11-27";
  change($("#nextPayDate"));
  $("#blockSize").value = "7";
  change($("#blockSize"));
  const blocks = $$("#timeline .block");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].querySelector('[data-block="start"]').value, "2026-11-13");
  assert.doesNotMatch(blocks[0].querySelector(".block-days").textContent, /NaN/);
  assert.match(blocks[0].querySelector(".block-bills").textContent, /nothing due/);
});

test("adding a bill routes it into the right block and the due subtotal updates", () => {
  click($("#add-bill"));
  const row = $('[data-kind="bill"]');
  const set = (sel, val) => {
    const el = row.querySelector(sel);
    el.value = val;
    input(el);
  };
  set('[data-bill="name"]', "Rent");
  set('[data-bill="amount"]', "800");
  set('[data-bill="dueDate"]', "2026-11-14");
  assert.equal($("#due-total").textContent, "$800.00");
  assert.match($("#due-status").textContent, /more due than the bills bucket covers/);
  const block0 = $$('#timeline .block')[0];
  assert.match(block0.querySelector(".block-bills").textContent, /Rent/);
});

test("a matching bills % clears the danger and shows covered", () => {
  const pctBills = $('#pct-bills');
  pctBills.value = "100";
  input(pctBills);
  assert.equal($("#due-total").textContent, "$800.00");
  assert.match($("#due-status").textContent, /covered by the bills bucket/);
  pctBills.value = "25";
  input(pctBills);
});

test("negative amount input triggers safe-zero danger, zero amount is only a warning", () => {
  $("#amount").value = "-50";
  input($("#amount"));
  assert.match($("#warnings").textContent, /negative/i);
  $("#amount").value = "0";
  input($("#amount"));
  assert.match($("#warnings").textContent, /zero/i);
  $("#amount").value = "1600";
  input($("#amount"));
});

test("preset button applies percentages across all four inputs", () => {
  click(document.querySelector('.preset[data-preset="25,25,25,25"]'));
  for (const bucket of ["needs", "bills", "fun", "sinking"]) {
    assert.equal($(`#pct-${bucket}`).value, "25");
  }
});

test("editable timeline: renaming a block label persists to plan", async () => {
  const label = $$("#timeline .block")[0].querySelector('[data-block="label"]');
  label.value = "Week one";
  change(label);
  await tick(); // debounced save
  const saved = JSON.parse(localStorage.getItem("paycheck-split-planner:v1"));
  assert.equal(saved.blocks[0].label, "Week one");
});

test("plan survives a simulated reload (localStorage round-trip)", async () => {
  await tick(); // allow debounced save
  const saved = JSON.parse(localStorage.getItem("paycheck-split-planner:v1"));
  assert.equal(saved.amount, "1600");
  assert.equal(saved.bills.length, 1);
  assert.equal(saved.bills[0].name, "Rent");
  assert.equal(saved.percents.bills, 25);
  assert.equal(saved.blocks.length, 2);
});

test("remove bill button drops the row and updates the subtotal", () => {
  click($('[data-kind="bill"] .row-remove'));
  assert.equal($$('[data-kind="bill"]').length, 0);
  assert.equal($("#due-total").textContent, "$0.00");
});
