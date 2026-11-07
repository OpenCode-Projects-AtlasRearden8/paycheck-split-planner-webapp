/**
 * app.js — Paycheck Split Planner UI.
 *
 * Local-first: all state lives in localStorage. No network calls, no backend.
 * All money math lives in split.js (tested); this file only wires the DOM.
 */

import {
  BUCKETS,
  derivePlanView,
  buildTimeline,
  sumCents,
} from "./split.js";

const STORAGE_KEY = "paycheck-split-planner:v1";

const BUCKET_META = {
  needs: { label: "Needs", hint: "gas, groceries,medicine — the must-haves of daily life" },
  bills: { label: "Bills", hint: "target: bills due before your next check" },
  fun: { label: "Fun", hint: "guilt-free spending" },
  sinking: { label: "Sinking pots", hint: "saving across checks for known-but-not-monthly stuff" },
};

const DEFAULT_PLAN = {
  amount: "",
  payDate: "",
  nextPayDate: "",
  blockSizeDays: 0,
  percents: { needs: 50, bills: 25, fun: 15, sinking: 10 },
  bills: [],
  pots: [],
  blocks: [],
  largePrint: false,
};

let plan = loadPlan();

/* ---------- storage ---------- */

function loadPlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_PLAN);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_PLAN), ...parsed };
  } catch {
    return structuredClone(DEFAULT_PLAN);
  }
}

let saveTimer;
function savePlan() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    } catch {
      /* storage full or blocked — the app still works for this session */
    }
  }, 250);
}

/* ---------- helpers ---------- */

const $ = (sel) => document.querySelector(sel);

const fmt = (cents) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------- rendering (structure) ---------- */

function renderSplitInputs() {
  const grid = $("#split-grid");
  grid.innerHTML = BUCKETS.map(
    (bucket) => `
    <div class="field">
      <label for="pct-${bucket}">${BUCKET_META[bucket].label} %</label>
      <input id="pct-${bucket}" data-pct="${bucket}" type="number" min="0" max="100" step="1"
             inputmode="decimal" value="${plan.percents[bucket] ?? 0}" />
      <small class="hint">${BUCKET_META[bucket].hint}</small>
    </div>`
  ).join("");
}

function billRowHtml(bill) {
  return `
  <div class="row" data-kind="bill">
    <div class="field">
      <label class="row-label">Bill name</label>
      <input data-bill="name" type="text" placeholder="Rent" value="${esc(bill.name)}" />
    </div>
    <div class="field">
      <label class="row-label">Amount $</label>
      <input data-bill="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${esc(bill.amount)}" />
    </div>
    <div class="field">
      <label class="row-label">Due date</label>
      <input data-bill="dueDate" type="date" value="${esc(bill.dueDate)}" />
    </div>
    <button type="button" class="btn btn-rowbtn row-remove" data-remove-bill aria-label="Remove this bill">✕</button>
  </div>`;
}

function potRowHtml(pot) {
  return `
  <div class="row pot-row" data-kind="pot">
    <div class="field">
      <label class="row-label">Pot name</label>
      <input data-pot="name" type="text" placeholder="Car tires" value="${esc(pot.name)}" />
    </div>
    <div class="field">
      <label class="row-label">This check $</label>
      <input data-pot="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${esc(pot.amount)}" />
    </div>
    <div class="field">
      <label class="row-label">Goal (optional) $</label>
      <input data-pot="target" type="number" min="0" step="0.01" inputmode="decimal" placeholder="400" value="${esc(pot.target)}" />
    </div>
    <button type="button" class="btn btn-rowbtn row-remove" data-remove-pot aria-label="Remove this pot">✕</button>
  </div>`;
}

function billDataFromRow(row) {
  const get = (k) => row.querySelector(`[data-bill="${k}"]`).value;
  return { name: get("name"), amount: get("amount"), dueDate: get("dueDate") };
}

function potDataFromRow(row) {
  const get = (k) => row.querySelector(`[data-pot="${k}"]`).value;
  return { name: get("name"), amount: get("amount"), target: get("target") };
}

function renderLists() {
  $("#bills-rows").innerHTML =
    plan.bills.map(billRowHtml).join("") ||
    `<p class="empty-note">No bills yet. Add the ones that hit before your next check — or none at all, that's allowed.</p>`;
  $("#pot-rows").innerHTML =
    plan.pots.map(potRowHtml).join("") ||
    `<p class="empty-note">No pots yet. Even one small pot ("$5/check → tires") is a great start.</p>`;
}

function blockHtml(block, index) {
  return `
  <div class="block" data-block-idx="${index}">
    <div class="block-head">
      <span class="row-label">Block</span>
      <input class="block-label" data-block="label" type="text" value="${esc(block.label)}" aria-label="Block ${index + 1} label" />
      <input data-block="start" type="date" value="${esc(block.start)}" aria-label="Block ${index + 1} start date" />
      <input data-block="end" type="date" value="${esc(block.end)}" aria-label="Block ${index + 1} end date (exclusive)" />
      <span class="block-days"></span>
    </div>
    <ul class="block-bills"></ul>
  </div>`;
}

function renderTimelineShell() {
  const timeline = $("#timeline");
  if (!plan.blocks.length) {
    timeline.innerHTML = "";
    return;
  }
  timeline.innerHTML = plan.blocks.map(blockHtml).join("");
}

/* ---------- rendering (numbers — no DOM rebuild) ---------- */

function updateOutputs() {
  const view = derivePlanView(plan);
  const s = view.split;

  // Split totals table
  $("#split-totals").innerHTML = BUCKETS.map(
    (bucket) => `
    <tr>
      <th scope="row">${BUCKET_META[bucket].label}${
        bucket === "bills" ? ` <span class="block-days">(auto: ${fmt(view.dueBillsTotal)} due)</span>` : ""
      }</th>
      <td>${s.percents[bucket]}%</td>
      <td>${fmt(s.cents[bucket])}</td>
    </tr>`
  ).join("");

  $("#leftover").textContent = fmt(s.leftoverCents);
  const pctSum = BUCKETS.reduce((sum, b) => sum + (s.percents[b] || 0), 0);
  $("#leftover-pct").textContent = `${Math.max(0, Math.round((100 - pctSum) * 100) / 100)}%`;
  $("#leftover").style.color = s.leftoverCents < 0 ? "var(--danger-ink)" : "";

  // Bills due before next pay
  $("#due-total").textContent = fmt(view.dueBillsTotal);
  const dueStatus = $("#due-status");
  if (view.dueBillsTotal > 0 && view.dueBillsTotal > s.cents.bills) {
    dueStatus.textContent = "⚠ more due than the bills bucket covers";
    dueStatus.className = "status danger";
  } else if (view.dueBillsTotal > 0) {
    dueStatus.textContent = "✓ covered by the bills bucket";
    dueStatus.className = "status ok";
  } else {
    dueStatus.textContent = "";
    dueStatus.className = "status";
  }

  // Sinking pots
  $("#pots-total").textContent = fmt(view.potsTotal);
  const potStatus = $("#pots-status");
  if (view.potsTotal > 0 && view.potsTotal > s.cents.sinking) {
    potStatus.textContent = "⚠ pots exceed the sinking bucket";
    potStatus.className = "status danger";
  } else if (view.potsTotal > 0) {
    potStatus.textContent = "✓ fits in the sinking bucket";
    potStatus.className = "status ok";
  } else {
    potStatus.textContent = "";
    potStatus.className = "status";
  }

  // Timeline fill-in (labels/dates are inputs; refresh days + bills only)
  const hasWindow = Boolean(plan.payDate && plan.nextPayDate && plan.nextPayDate > plan.payDate);
  $("#timeline-empty").classList.toggle("hidden", hasWindow && plan.blocks.length > 0);
  document.querySelectorAll("#timeline .block").forEach((el) => {
    const idx = Number(el.dataset.blockIdx);
    const block = view.timeline[idx];
    if (!block) return;
    const days = block.days ?? Math.round((new Date(`${block.end}T00:00:00`) - new Date(`${block.start}T00:00:00`)) / 86400000);
    const daysEl = el.querySelector(".block-days");
    daysEl.textContent = `· ${days} day${days === 1 ? "" : "s"} · ${fmt(block.billsTotal)} in bills`;
    const list = el.querySelector(".block-bills");
    list.innerHTML = block.bills.length
      ? block.bills
          .map(
            (b) =>
              `<li>${esc(b.name || "Untitled bill")} — ${fmt(sumCents([b.amount]))} due ${esc(b.dueDate)}</li>`
          )
          .join("")
      : `<li class="none">nothing due in this block</li>`;
  });

  // Warnings (safe-zero)
  const warnings = $("#warnings");
  if (!view.warnings.length) {
    warnings.innerHTML = `<li class="fine"><span class="ok-mark">✓</span> All clear — every dollar of this check is planned, and nothing is over-spent.</li>`;
  } else {
    warnings.innerHTML = view.warnings
      .map((w) => `<li class="${w.level}">${esc(w.message)}</li>`)
      .join("");
  }
}

function computeFromDates() {
  plan.blocks = buildTimeline(plan.payDate, plan.nextPayDate, plan.blockSizeDays);
}

function syncAndSave() {
  savePlan();
  updateOutputs();
}

/* ---------- events ---------- */

function wireEvents() {
  $("#amount").addEventListener("input", (e) => {
    plan.amount = e.target.value;
    syncAndSave();
  });

  $("#payDate").addEventListener("change", (e) => {
    plan.payDate = e.target.value;
    computeFromDates();
    renderTimelineShell();
    syncAndSave();
  });

  $("#nextPayDate").addEventListener("change", (e) => {
    plan.nextPayDate = e.target.value;
    computeFromDates();
    renderTimelineShell();
    syncAndSave();
  });

  $("#blockSize").addEventListener("change", (e) => {
    plan.blockSizeDays = Number(e.target.value);
    computeFromDates();
    renderTimelineShell();
    syncAndSave();
    toast("Timeline rebuilt");
  });

  $("#split-grid").addEventListener("input", (e) => {
    const bucket = e.target.dataset.pct;
    if (!bucket) return;
    plan.percents[bucket] = e.target.value === "" ? 0 : Number(e.target.value);
    syncAndSave();
  });

  document.querySelectorAll(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [needs, bills, fun, sinking] = btn.dataset.preset.split(",").map(Number);
      Object.assign(plan.percents, { needs, bills, fun, sinking });
      renderSplitInputs();
      syncAndSave();
      toast("Presets applied");
    });
  });

  $("#add-bill").addEventListener("click", () => {
    plan.bills.push({ name: "", amount: "", dueDate: "" });
    renderLists();
    syncAndSave();
    const rows = document.querySelectorAll('[data-kind="bill"] input[data-bill="name"]');
    rows[rows.length - 1]?.focus();
  });

  $("#add-pot").addEventListener("click", () => {
    plan.pots.push({ name: "", amount: "", target: "" });
    renderLists();
    syncAndSave();
    const rows = document.querySelectorAll('[data-kind="pot"] input[data-pot="name"]');
    rows[rows.length - 1]?.focus();
  });

  const lists = $("#main");
  lists.addEventListener("input", (e) => {
    const row = e.target.closest('[data-kind="bill"], [data-kind="pot"]');
    if (!row) return;
    if (row.dataset.kind === "bill") {
      const all = [...document.querySelectorAll('[data-kind="bill"]')];
      plan.bills[all.indexOf(row)] = billDataFromRow(row);
    } else {
      const all = [...document.querySelectorAll('[data-kind="pot"]')];
      plan.pots[all.indexOf(row)] = potDataFromRow(row);
    }
    syncAndSave();
  });

  lists.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove-bill], [data-remove-pot]");
    if (!removeBtn) return;
    const row = removeBtn.closest('[data-kind="bill"], [data-kind="pot"]');
    const all = [...document.querySelectorAll(row.dataset.kind === "bill" ? '[data-kind="bill"]' : '[data-kind="pot"]')];
    const idx = all.indexOf(row);
    if (row.dataset.kind === "bill") plan.bills.splice(idx, 1);
    else plan.pots.splice(idx, 1);
    renderLists();
    syncAndSave();
    toast("Removed");
  });

  $("#rebuild-blocks").addEventListener("click", () => {
    computeFromDates();
    renderTimelineShell();
    syncAndSave();
    toast(plan.blocks.length ? "Timeline rebuilt" : "Set both pay dates first");
  });

  // Editable timeline blocks
  lists.addEventListener("change", (e) => {
    const blockEl = e.target.closest('[data-block-idx]');
    if (!blockEl || !e.target.dataset.block) return;
    const idx = Number(blockEl.dataset.blockIdx);
    const key = e.target.dataset.block;
    plan.blocks[idx][key] = e.target.value;
    syncAndSave();
  });

  $("#large-print").addEventListener("change", (e) => {
    plan.largePrint = e.target.checked;
    document.documentElement.classList.toggle("xl", plan.largePrint);
    savePlan();
  });

  $("#reset-btn").addEventListener("click", () => {
    if (!confirm("Start over? This clears the current plan from the form (your saved data is replaced on next save).")) return;
    plan = structuredClone(DEFAULT_PLAN);
    localStorage.removeItem(STORAGE_KEY);
    hydrateInputs();
    renderSplitInputs();
    renderLists();
    renderTimelineShell();
    syncAndSave();
    toast("Fresh start");
  });

  $("#clear-btn").addEventListener("click", () => {
    if (!confirm("Clear all saved data from this browser? The current form stays as-is until reload.")) return;
    localStorage.removeItem(STORAGE_KEY);
    plan = structuredClone(DEFAULT_PLAN);
    hydrateInputs();
    renderSplitInputs();
    renderLists();
    renderTimelineShell();
    syncAndSave();
    toast("Saved data cleared");
  });

  $("#export-btn").addEventListener("click", async () => {
    const json = JSON.stringify(plan, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      toast("Plan JSON copied to clipboard");
    } catch {
      toast("Clipboard unavailable — use Download instead");
    }
  });

  $("#export-download").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "paycheck-split-plan.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Plan downloaded");
  });
}

/* ---------- init ---------- */

function hydrateInputs() {
  $("#amount").value = plan.amount;
  $("#payDate").value = plan.payDate;
  $("#nextPayDate").value = plan.nextPayDate;
  $("#blockSize").value = String(plan.blockSizeDays ?? 0);
  $("#large-print").checked = Boolean(plan.largePrint);
  document.documentElement.classList.toggle("xl", Boolean(plan.largePrint));
  if (!plan.blocks.length && plan.payDate && plan.nextPayDate) {
    computeFromDates();
  }
}

function init() {
  hydrateInputs();
  renderSplitInputs();
  renderLists();
  renderTimelineShell();
  wireEvents();
  updateOutputs();
}

// DOM wiring only runs in a browser-like environment; tests import this
// module with jsdom globals set up first.
if (typeof document !== "undefined") {
  init();
}
