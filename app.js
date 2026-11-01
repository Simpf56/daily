'use strict';

const STORE_KEY = 'daily.v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { entries: s.entries || [], running: s.running || null, goal: s.goal ?? 8 };
    }
  } catch (e) { console.warn('Could not load data', e); }
  return { entries: [], running: null, goal: 8 };
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save'); }
}

const state = loadState();

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, '0');

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek(ts) { // monday
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
function startOfMonth(ts) { const d = new Date(startOfDay(ts)); d.setDate(1); return d.getTime(); }

function fmtDur(ms, withSeconds = false) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return withSeconds ? `${h}:${pad(m)}:${pad(s)}` : `${h}:${pad(m)}`;
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function allSessions() {
  const list = [...state.entries];
  if (state.running) list.push({ id: 'running', start: state.running.start, end: Date.now(), note: state.running.note, running: true });
  return list;
}
function totalBetween(from, to) {
  return allSessions()
    .filter((e) => e.start >= from && e.start < to)
    .reduce((sum, e) => sum + (e.end - e.start), 0);
}
function groupByDay(sessions) {
  const map = new Map();
  for (const e of sessions) {
    const k = dayKey(e.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  return map;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

function toggleTimer() {
  if (state.running) {
    const end = Date.now();
    if (end - state.running.start >= 1000) {
      state.entries.push({ id: uid(), start: state.running.start, end, note: $('session-note').value.trim() });
    }
    state.running = null;
    $('session-note').value = '';
    toast('Session saved');
  } else {
    state.running = { start: Date.now(), note: $('session-note').value.trim() };
  }
  saveState();
  render();
}

$('session-note').addEventListener('input', () => {
  if (state.running) { state.running.note = $('session-note').value.trim(); saveState(); }
});

const RING_LEN = 2 * Math.PI * 52;

function entryHtml(e) {
  const end = e.running ? 'now' : fmtTime(e.end);
  return `<li class="entry${e.running ? ' running' : ''}" data-id="${e.id}">
    <div>
      <div class="entry-time">${fmtTime(e.start)} – ${end}</div>
      ${e.note ? `<div class="entry-note">${escapeHtml(e.note)}</div>` : ''}
    </div>
    <div class="entry-dur">${fmtDur(e.end - e.start)}</div>
  </li>`;
}

function renderToday() {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const total = totalBetween(todayStart, todayStart + 86400000);
  const goalMs = state.goal * 3600000;

  $('today-label').textContent = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  $('today-total').textContent = fmtDur(total);
  $('goal-text').textContent = state.goal > 0 ? `of ${state.goal}h goal` : 'worked today';

  const ring = $('goal-ring');
  const pct = goalMs > 0 ? Math.min(1, total / goalMs) : 0;
  ring.style.strokeDasharray = RING_LEN;
  ring.style.strokeDashoffset = RING_LEN * (1 - pct);

  const btn = $('toggle-btn'), clock = $('session-clock');
  if (state.running) {
    btn.textContent = 'Stop';
    btn.className = 'btn btn-big btn-stop';
    clock.textContent = `Working · ${fmtDur(now - state.running.start, true)}`;
    clock.classList.add('live');
    if (document.activeElement !== $('session-note')) $('session-note').value = state.running.note || '';
  } else {
    btn.textContent = 'Start working';
    btn.className = 'btn btn-big btn-start';
    clock.textContent = 'Not working';
    clock.classList.remove('live');
  }

  const today = allSessions().filter((e) => e.start >= todayStart).sort((a, b) => b.start - a.start);
  $('today-list').innerHTML = today.length ? today.map(entryHtml).join('') : '<li class="empty">No sessions yet today</li>';
}

function renderHistory() {
  const groups = groupByDay(allSessions());
  const keys = [...groups.keys()].sort().reverse();
  if (!keys.length) { $('history-list').innerHTML = '<p class="empty">Nothing tracked yet</p>'; return; }

  const open = new Set([...document.querySelectorAll('#history-list details[open]')].map((d) => d.dataset.day));
  let html = '', lastMonth = '';
  for (const k of keys) {
    const month = k.slice(0, 7);
    if (month !== lastMonth) {
      const [y, m] = month.split('-').map(Number);
      html += `<div class="month-head">${new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })}</div>`;
      lastMonth = month;
    }
    const items = groups.get(k).sort((a, b) => a.start - b.start);
    const total = items.reduce((s, e) => s + (e.end - e.start), 0);
    html += `<details class="day" data-day="${k}"${open.has(k) ? ' open' : ''}>
      <summary><span>${fmtDay(k)}</span><span>${fmtDur(total)}</span></summary>
      <ul class="list">${items.map(entryHtml).join('')}</ul>
    </details>`;
  }
  $('history-list').innerHTML = html;
}

function renderSummary() {
  const now = Date.now();
  const week = totalBetween(startOfWeek(now), Infinity);
  const monthStart = startOfMonth(now);
  const month = totalBetween(monthStart, Infinity);

  const days = groupByDay(allSessions());
  const workedDays = [...days.keys()];
  const allTotal = allSessions().reduce((s, e) => s + (e.end - e.start), 0);
  const monthDays = workedDays.filter((k) => k >= dayKey(monthStart)).length;

  $('stat-week').textContent = fmtDur(week);
  $('stat-month').textContent = fmtDur(month);
  $('stat-avg').textContent = fmtDur(workedDays.length ? allTotal / workedDays.length : 0);
  $('stat-days').textContent = monthDays;

  const bars = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(startOfDay(now)); d.setDate(d.getDate() - i);
    const from = d.getTime(), to = new Date(d).setDate(d.getDate() + 1);
    bars.push({ label: d.toLocaleDateString([], { weekday: 'short' }), total: totalBetween(from, to), today: i === 0 });
  }
  const max = Math.max(state.goal * 3600000, ...bars.map((b) => b.total), 1);
  $('chart').innerHTML = bars.map((b) => `
    <div class="bar-col${b.today ? ' today' : ''}">
      <div class="bar-val">${b.total ? fmtDur(b.total) : ''}</div>
      <div class="bar" style="height:${(b.total / max) * 100}%"></div>
      <div class="bar-lbl">${b.label}</div>
    </div>`).join('');

  if (document.activeElement !== $('goal-input')) $('goal-input').value = state.goal;
}

let currentView = 'today';
function render() {
  if (currentView === 'today') renderToday();
  else if (currentView === 'history') renderHistory();
  else renderSummary();
}

setInterval(() => { if (state.running && currentView === 'today') renderToday(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    currentView = tab.dataset.view;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${currentView}`; });
    window.scrollTo(0, 0);
    render();
  });
});

let editingId = null;

function toTimeInput(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function openEditor(entry) {
  editingId = entry ? entry.id : null;
  $('editor-title').textContent = entry ? 'Edit session' : 'Add session';
  $('ed-delete').hidden = !entry;
  $('ed-error').hidden = true;
  const now = Date.now();
  $('ed-date').value = dayKey(entry ? entry.start : now);
  $('ed-start').value = entry ? toTimeInput(entry.start) : '09:00';
  $('ed-end').value = entry ? toTimeInput(entry.end) : '17:00';
  $('ed-note').value = entry ? entry.note || '' : '';
  $('editor').showModal();
}

function listClick(ev) {
  const li = ev.target.closest('.entry');
  if (!li) return;
  if (li.dataset.id === 'running') { toast('Stop the timer first'); return; }
  const entry = state.entries.find((e) => e.id === li.dataset.id);
  if (entry) openEditor(entry);
}
$('today-list').addEventListener('click', listClick);
$('history-list').addEventListener('click', listClick);
$('add-btn').addEventListener('click', () => openEditor(null));
$('add-btn-2').addEventListener('click', () => openEditor(null));
$('ed-cancel').addEventListener('click', () => $('editor').close());

$('ed-delete').addEventListener('click', () => {
  const btn = $('ed-delete');
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1';
    btn.textContent = 'Tap again to delete';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Delete'; }, 3000);
    return;
  }
  btn.dataset.confirm = '';
  btn.textContent = 'Delete';
  state.entries = state.entries.filter((e) => e.id !== editingId);
  saveState();
  $('editor').close();
  toast('Session deleted');
  render();
});

$('editor-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const [y, mo, d] = $('ed-date').value.split('-').map(Number);
  const [sh, sm] = $('ed-start').value.split(':').map(Number);
  const [eh, em] = $('ed-end').value.split(':').map(Number);
  const start = new Date(y, mo - 1, d, sh, sm).getTime();
  let end = new Date(y, mo - 1, d, eh, em).getTime();
  if (end <= start) end += 86400000; // past midnight

  const err = $('ed-error');
  if (end - start > 24 * 3600000) { err.textContent = 'A session can be at most 24 hours.'; err.hidden = false; return; }

  const note = $('ed-note').value.trim();
  if (editingId) {
    Object.assign(state.entries.find((e) => e.id === editingId), { start, end, note });
  } else {
    state.entries.push({ id: uid(), start, end, note });
  }
  saveState();
  $('editor').close();
  toast('Saved');
  render();
});

$('goal-input').addEventListener('change', () => {
  const v = parseFloat($('goal-input').value);
  state.goal = Number.isFinite(v) && v >= 0 && v <= 24 ? v : 8;
  saveState();
  render();
});

async function shareOrDownload(filename, text, mime) {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('export-json').addEventListener('click', () => {
  const data = JSON.stringify({ app: 'daily-hours', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2);
  shareOrDownload(`daily-hours-backup-${dayKey(Date.now())}.json`, data, 'application/json');
});

$('export-csv').addEventListener('click', () => {
  const rows = [['Date', 'Start', 'End', 'Hours', 'Note']];
  for (const e of [...state.entries].sort((a, b) => a.start - b.start)) {
    rows.push([dayKey(e.start), toTimeInput(e.start), toTimeInput(e.end), ((e.end - e.start) / 3600000).toFixed(2), e.note || '']);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  shareOrDownload(`daily-hours-${dayKey(Date.now())}.csv`, csv, 'text/csv');
});

$('import-btn').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0];
  $('import-file').value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.entries)) throw new Error('not a backup');
    const valid = data.entries.filter((e) => e && Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start);
    const have = new Set(state.entries.map((e) => e.id));
    let added = 0;
    for (const e of valid) {
      if (!have.has(e.id)) { state.entries.push({ id: e.id || uid(), start: e.start, end: e.end, note: String(e.note || '') }); added++; }
    }
    if (typeof data.goal === 'number') state.goal = data.goal;
    saveState();
    render();
    toast(`Restored ${added} session${added === 1 ? '' : 's'}`);
  } catch (e) {
    toast('Not a backup file');
  }
});

$('toggle-btn').addEventListener('click', toggleTimer);
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
