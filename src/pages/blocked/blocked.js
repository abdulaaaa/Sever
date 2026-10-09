import { loadState, scheduleLabel, timeLabel, summarize } from "../../utils/common.js";
import { recordAttempt, loadAttempts } from "../../services/supa.js";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const title = (text) => {
  $("title").replaceChildren("Blocked: ", Object.assign(document.createElement("span"), { textContent: text }));
};

async function show() {
  const st = await loadState();

  if (params.has("budget")) {
    const mins = st.settings.daily_limit_minutes;
    $("label").textContent = "Daily limit";
    $("title").textContent = "Today's social media time is used up";
    $("sub").textContent = `You've used ${Math.floor(st.used / 60)} of your ${mins} minutes. The time resets at midnight.`;
    $("bar").hidden = false;
    $("note").textContent = "Other websites still work.";
    return;
  }

  const block = st.blocks.find((b) => b.id === params.get("id"));
  if (!block) return;
  title(block.target);

  if (block.schedule) {
    $("label").textContent = "Scheduled block";
    $("sub").textContent = `Blocked ${scheduleLabel(block.schedule)}.`;
    $("note").textContent = `Available again at ${timeLabel(block.schedule.end)}.`;
    return;
  }

  if (!block.person) {
    $("label").textContent = "Always blocked";
    $("sub").textContent = "This is blocked at all times.";
    return;
  }

  $("label").textContent = block.person;
  // Count this attempt once (not again if the page is refreshed, or if the tab was already open).
  const counting = !params.has("n") && !params.has("c");
  if (counting) {
    params.set("c", "1");
    history.replaceState(null, "", "?" + params.toString());
    await recordAttempt(block.target);
  }
  const times = (await loadAttempts(block.target))[block.target] || [];
  const c = summarize(times);
  $("sub").textContent = params.has("n")
    ? "This tab was already open when the block started, so it wasn't counted."
    : `You've tried to open this ${c.total} time${c.total === 1 ? "" : "s"}.`;
  $("c-today").textContent = c.today;
  $("c-week").textContent = c.week;
  $("c-total").textContent = c.total;
  $("counts").hidden = false;
}

show();
