// Blocks typing a blocked person's name into search engines and social sites.
// The text is compared here in the page; only the matched block id is sent on.
import { watchMatch, type WatchTerm } from '../lib/utils/watch';

let active = false;
let terms: WatchTerm[] = [];

function load(): void {
  chrome.runtime.sendMessage({ type: 'watchConfig' }, (r?: { active: boolean; terms: WatchTerm[] }) => {
    if (chrome.runtime.lastError || !r) return;
    active = r.active;
    terms = r.terms;
  });
}

const TEXT_INPUTS = ['text', 'search', 'url', 'email', 'tel'];

function typed(el: EventTarget | undefined): string {
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.includes(el.type) ? el.value : '';
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLElement && el.isContentEditable) return el.textContent || '';
  return '';
}

document.addEventListener('input', (e) => {
  if (!active || !terms.length) return;
  const el = e.composedPath()[0];
  const hit = watchMatch(typed(el).slice(-200), terms);
  if (!hit) return;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = '';
  else if (el instanceof HTMLElement) el.textContent = '';
  chrome.runtime.sendMessage({ type: 'watchHit', id: hit.id });
}, true);

load();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.cache) load();
});
