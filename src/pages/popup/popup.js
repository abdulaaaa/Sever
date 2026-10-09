import { loadState, schedActive, timeLabel, summarize } from "../../utils/common.js";
import { loadAttempts } from "../../services/supa.js";

const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text ?? "", className: cls || "" });
const row = (cells, cls) => { const tr = el("tr", "", cls); cells.forEach((c) => tr.append(el("td", String(c)))); return tr; };

$("settings").onclick = () => chrome.runtime.openOptionsPage();

async function render() {
  const st = await loadState();
  if (!st.session) {
    $("notice").textContent = "Not signed in: using your saved blocks. Sign in from Settings to sync both profiles.";
    $("notice").hidden = false;
  } else if (st.lastError) {
    $("notice").textContent = "Couldn't reach the database. Your saved blocks still apply.";
    $("notice").hidden = false;
  }

  const left = Math.max(0, Math.ceil((st.limit - st.used) / 60));
  $("left").textContent = left === 0 ? "Used up" : `${left} min left`;
  $("used").textContent = `${Math.floor(st.used / 60)} of ${st.settings.daily_limit_minutes} min used`;
  const pct = Math.min(100, (st.used / st.limit) * 100);
  $("fill").style.width = pct + "%";
  $("bar").className = "bar" + (left === 0 ? " out" : left <= 10 ? " warn" : "");

  const active = st.blocks.filter((b) => b.kind !== "allow" && b.schedule && schedActive(b.schedule));
  const groups = {};
  for (const b of active) (groups[b.schedule.end] = groups[b.schedule.end] || []).push(b.target);
  const list = $("active");
  for (const [end, targets] of Object.entries(groups)) list.append(el("li", `${targets.join(", ")} until ${timeLabel(end)}`));
  if (st.out) list.append(el("li", "All social media (daily limit used up) until midnight"));
  if (!list.children.length) list.append(el("li", "Only your always-on blocks.", "muted"));

  const attempts = await loadAttempts();
  const people = [...new Set(st.blocks.filter((b) => b.person).map((b) => b.person))];
  const body = $("people");
  for (const name of people) {
    const entries = st.blocks.filter((b) => b.person === name);
    const counts = entries.map((b) => summarize(attempts[b.target]));
    const sum = (k) => counts.reduce((a, c) => a + c[k], 0);
    body.append(row([name, sum("today"), sum("week"), sum("total")], "person"));
    entries.forEach((b, i) => body.append(row([b.target, counts[i].today, counts[i].week, counts[i].total])));
  }
  if (!people.length) body.append(row(["No people added yet.", "", "", ""]));
}

render();
