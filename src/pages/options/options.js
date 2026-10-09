import { loadState, cleanTarget, scheduleLabel, schedActive, normHost } from "../../utils/common.js";
import { signIn, signOut, api } from "../../services/supa.js";

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text ?? "", className: cls || "" });
let st = null;

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

const syncNow = () => chrome.runtime.sendMessage({ type: "sync" });

async function run(action, done) {
  try {
    await action();
    await syncNow();
    await render();
    if (done) toast(done);
  } catch (e) {
    toast(e.message === "signed-out" ? "Sign in first." : "Couldn't save: " + e.message);
  }
}

const addBlock = (row) => api("blocks", { method: "POST", body: [{ person: null, schedule: null, ...row }], prefer: "return=minimal" });
const removeBlock = (b, label) => {
  if (!confirm(`Remove ${label || b.target}?`)) return;
  run(() => api(`blocks?id=eq.${b.id}`, { method: "DELETE" }), "Removed.");
};
const saveSettings = (patch) =>
  api(`settings?user_id=eq.${st.session.user.id}`, {
    method: "PATCH", body: { ...patch, updated_at: new Date().toISOString() }, prefer: "return=minimal"
  });

function item(text, extra, onRemove) {
  const li = el("li");
  li.append(el("span", text, "t"));
  if (extra) li.append(extra);
  const x = el("button", "Remove", "link");
  x.type = "button";
  x.onclick = onRemove;
  li.append(x);
  return li;
}

async function render() {
  st = await loadState();
  const signedIn = !!st.session;
  $("signed-out").hidden = signedIn;
  $("signed-in").hidden = !signedIn;
  $("editable").disabled = !signedIn;
  if (signedIn) {
    $("who").textContent = st.session.user.email;
    $("sync-status").textContent = st.lastError
      ? "Couldn't reach the database: " + st.lastError
      : st.syncedAt ? "Last synced " + new Date(st.syncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Not synced yet";
  }

  // Daily limit
  if (document.activeElement !== $("limit")) $("limit").value = st.settings.daily_limit_minutes;
  const chips = $("budget-sites");
  chips.replaceChildren();
  for (const site of st.settings.budget_sites) {
    const c = el("span", site, "chip");
    const x = el("button", "×", "link");
    x.type = "button";
    x.title = "Remove " + site;
    x.onclick = () => {
      if (!confirm(`Stop counting ${site} toward the daily limit?`)) return;
      run(() => saveSettings({ budget_sites: st.settings.budget_sites.filter((s) => s !== site) }), "Removed.");
    };
    c.append(x);
    chips.append(c);
  }

  // People
  const people = $("people");
  people.replaceChildren();
  const names = [...new Set(st.blocks.filter((b) => b.person).map((b) => b.person))];
  $("names").replaceChildren(...names.map((n) => Object.assign(document.createElement("option"), { value: n })));
  for (const name of names) {
    people.append(el("div", name, "person-h"));
    const ul = el("ul", "", "items");
    for (const b of st.blocks.filter((b) => b.person === name)) ul.append(item(b.target, null, () => removeBlock(b)));
    people.append(ul);
  }
  if (!names.length) people.append(el("div", "No people yet.", "empty"));

  // Always blocked
  const always = $("always");
  always.replaceChildren();
  for (const b of st.blocks.filter((b) => b.kind !== "allow" && !b.person && !b.schedule)) {
    always.append(item(b.target, el("span", b.kind === "site" ? "whole site" : "page", "tag"), () => removeBlock(b)));
  }
  if (!always.children.length) always.append(el("li", "Nothing here yet.", "empty"));

  // Scheduled
  const sched = $("scheduled");
  sched.replaceChildren();
  for (const b of st.blocks.filter((b) => b.kind !== "allow" && b.schedule)) {
    const on = schedActive(b.schedule);
    const extra = el("span", "");
    extra.append(el("span", scheduleLabel(b.schedule) + "  ", "muted"), el("span", on ? "active now" : "off now", "tag" + (on ? " on" : "")));
    sched.append(item(b.target + (b.kind === "site" ? "" : " (page)"), extra, () => removeBlock(b)));
  }
  if (!sched.children.length) sched.append(el("li", "Nothing scheduled.", "empty"));

  // Allowed
  const allowed = $("allowed");
  allowed.replaceChildren();
  for (const b of st.blocks.filter((b) => b.kind === "allow")) allowed.append(item(b.target, null, () => removeBlock(b)));
  if (!allowed.children.length) allowed.append(el("li", "Nothing here yet.", "empty"));
}

// Day picker for schedules (Mon first).
const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
for (const [v, label] of DAYS) {
  const l = el("label");
  const i = Object.assign(document.createElement("input"), { type: "checkbox", value: v, checked: true });
  l.append(i, label);
  $("sched-days").append(l);
}

const kindOf = (name) => document.querySelector(`input[name=${name}]:checked`).value;
const exists = (kind, target, extra = () => true) => st.blocks.some((b) => b.kind === kind && b.target === target && extra(b));

$("signin").onsubmit = async (e) => {
  e.preventDefault();
  $("account-msg").textContent = "Signing in…";
  $("account-msg").className = "msg";
  try {
    await signIn($("email").value.trim(), $("password").value);
    $("password").value = "";
    $("account-msg").textContent = "Signed in. Syncing…";
    await syncNow();
    $("account-msg").textContent = "";
    await render();
  } catch (err) {
    $("account-msg").textContent = "Couldn't sign in: " + err.message;
    $("account-msg").className = "msg err";
  }
};
$("signout").onclick = async () => {
  if (!confirm("Sign out? Your saved blocks keep working, but changes won't sync.")) return;
  await signOut();
  await render();
};
$("sync-now").onclick = async () => { await syncNow(); await render(); toast("Synced."); };

$("limit-form").onsubmit = (e) => {
  e.preventDefault();
  const v = Math.round(Number($("limit").value));
  if (!(v >= 1 && v <= 1440)) return toast("Enter a number of minutes.");
  run(() => saveSettings({ daily_limit_minutes: v }), "Limit saved.");
};

$("add-budget").onsubmit = (e) => {
  e.preventDefault();
  const t = cleanTarget($("budget-input").value, "site");
  if (!t) return toast("That doesn't look like a website.");
  if (st.settings.budget_sites.map(normHost).includes(t)) return toast("Already counted.");
  run(() => saveSettings({ budget_sites: [...st.settings.budget_sites, t] }), `Added ${t}.`).then(() => ($("budget-input").value = ""));
};

$("add-person").onsubmit = (e) => {
  e.preventDefault();
  const name = $("person-name").value.trim();
  const t = cleanTarget($("person-link").value, "page");
  if (!name) return toast("Add a name.");
  if (!t) return toast("That doesn't look like a link.");
  if (exists("page", t, (b) => b.person)) return toast("Already blocked.");
  run(() => addBlock({ kind: t.includes("/") ? "page" : "site", target: t, person: name }), `Blocked ${t}.`).then(() => ($("person-link").value = ""));
};

$("add-always").onsubmit = (e) => {
  e.preventDefault();
  const kind = kindOf("always-kind");
  const t = cleanTarget($("always-link").value, kind);
  if (!t) return toast("That doesn't look like a link.");
  const k = t.includes("/") ? "page" : "site";
  if (exists(k, t, (b) => !b.schedule && !b.person)) return toast("Already blocked.");
  run(() => addBlock({ kind: k, target: t }), `Blocked ${t}.`).then(() => ($("always-link").value = ""));
};

$("add-sched").onsubmit = (e) => {
  e.preventDefault();
  const kind = kindOf("sched-kind");
  const t = cleanTarget($("sched-link").value, kind);
  if (!t) return toast("That doesn't look like a link.");
  const days = [...$("sched-days").querySelectorAll("input:checked")].map((i) => Number(i.value)).sort();
  if (!days.length) return toast("Pick at least one day.");
  const schedule = { start: $("sched-start").value, end: $("sched-end").value, days };
  run(() => addBlock({ kind: t.includes("/") ? "page" : "site", target: t, schedule }), `Scheduled ${t}.`).then(() => ($("sched-link").value = ""));
};

$("add-allow").onsubmit = (e) => {
  e.preventDefault();
  const t = cleanTarget($("allow-link").value, "page");
  if (!t) return toast("That doesn't look like a link.");
  if (exists("allow", t)) return toast("Already allowed.");
  run(() => addBlock({ kind: "allow", target: t }), `Allowed ${t}.`).then(() => ($("allow-link").value = ""));
};

chrome.storage.onChanged.addListener((changes) => {
  if (changes.cache || changes.session || changes.syncedAt || changes.lastError) render();
});

render();
