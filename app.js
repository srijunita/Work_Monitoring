/* Study Tracker — frontend. Semua data disimpan di Google Sheets lewat Apps Script. */
(function () {
'use strict';

/* ---------- util ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const pd = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
const diff = (a, b) => Math.round((pd(a) - pd(b)) / 864e5);
const today = () => iso(new Date());
const monday = s => addDays(s, -((pd(s).getDay() + 6) % 7));
const fD = (s, o) => s ? new Intl.DateTimeFormat('id-ID', o || { day: 'numeric', month: 'short', year: 'numeric' }).format(pd(s)) : '–';
const nf = (n, d = 0) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: d }).format(n);
const dur = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h} j ${r} mnt` : `${h} jam`) : `${r} mnt`; };
const hrs = m => nf(m / 60, 1) + ' jam';
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const PROGS = ['HSK', 'FMVA', 'FPAP'];
const PNAME = { HSK: 'HSK', FMVA: 'FMVA', FPAP: 'FPAP' };
const HSK_ACTS = ['Textbook + workbook', 'Flashcard kosakata', 'Listening / shadowing', 'Kalimat sendiri', 'Latihan soal', 'Bacaan', 'Review'];
const HSK_TOPICS = ['Kosakata & flashcard', 'Review mingguan', 'Mock test', 'Bacaan Mandarin Bean', 'Listening'];
const ACT_LABEL = { 'Video + quiz': 'Video + kuis', 'Video only': 'Video materi', 'Excel exercise': 'Latihan Excel', 'Case study': 'Studi kasus', 'Course exam': 'Ujian kursus', 'Final exam review': 'Review ujian akhir', 'Final exam': 'Ujian akhir', 'Retake': 'Ujian ulang' };
const CSTAT = { 'Not started': 'Belum mulai', 'In progress': 'Berjalan', 'Done': 'Selesai', 'Retake': 'Ulang' };
const cstat = s => CSTAT[s] || String(s).replace('Failed', 'Gagal');
const stClass = s => (s === 'Done' || s === 'Selesai' || s === 'Hafal') ? 'done' : (s === 'In progress' || s === 'Proses' || s === 'Review' || s === 'Retake') ? 'prog' : s === 'Lompat' ? 'skip' : /^Failed/.test(s) ? 'fail' : 'todo';

/* ---------- state ---------- */
const S = {
  conn: LS.get('st.conn', null),
  data: LS.get('st.data', null),
  queue: LS.get('st.queue', []),
  view: 'beranda',
  syl: 'HSK',
  open: {},
  hist: { q: '', prog: 'all', period: 'all', status: 'all', from: '', to: '' },
  trend: 'harian', dist: 30, sel: -1,
  busy: 0, m: null, form: null
};

/* ---------- API ---------- */
async function api(action, payload) {
  let res;
  try {
    res = await fetch(S.conn.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: S.conn.key, action }, payload || {})) });
  } catch (e) {
    const er = new Error('Tidak ada koneksi internet.'); er.network = true; throw er;
  }
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('Jawaban server tidak terbaca. Periksa URL Apps Script (harus berakhiran /exec) dan akses deployment "Siapa saja".'); }
  if (!j.ok) { const er = new Error(j.error || 'Permintaan gagal.'); er.code = j.code; throw er; }
  if (j.data) { S.data = j.data; S.m = null; LS.set('st.data', j.data); }
  return j;
}

function setBusy(on) {
  S.busy += on ? 1 : -1;
  $('#syncbar').hidden = S.busy <= 0;
  $('#btn-refresh').classList.toggle('spin', S.busy > 0);
  chip();
}
function chip() {
  const c = $('#syncchip');
  if (S.queue.length) { c.hidden = false; c.textContent = S.queue.length + ' menunggu koneksi'; c.className = 'chip-sync wait'; }
  else if (S.busy > 0) { c.hidden = false; c.textContent = 'Menyinkronkan…'; c.className = 'chip-sync'; }
  else c.hidden = true;
}

/** Jalankan aksi tulis: tampilkan loading, toast sukses/gagal. */
async function run(action, payload, okMsg) {
  setBusy(true);
  try {
    await api(action, payload);
    if (okMsg) toast(okMsg, 'ok');
    return true;
  } catch (e) {
    toast(e.message, 'err');
    if (e.code === 'STALE') refresh(true);
    return false;
  } finally { setBusy(false); render(); }
}

async function refresh(quiet) {
  if (!S.conn) return;
  setBusy(true);
  try {
    await flushQueue();
    await api('load');
    if (!quiet) toast('Data terbaru dimuat dari Google Sheets.', 'ok');
  } catch (e) {
    if (!quiet || !S.data) toast(e.network ? 'Tidak ada koneksi. Menampilkan data terakhir yang tersimpan.' : e.message, 'err');
  } finally { setBusy(false); render(); }
}

async function flushQueue() {
  while (S.queue.length) {
    const q = S.queue[0];
    try { await api('addLog', { entry: q }); }
    catch (e) {
      if (e.network) return;
      toast('Sesi "' + (q.course || q.lesson) + '" ditolak: ' + e.message, 'err');
    }
    S.queue.shift(); LS.set('st.queue', S.queue); S.m = null;
    if (!S.queue.length) toast('Sesi yang tertunda sudah tersimpan ke Google Sheets.', 'ok');
  }
}

/* ---------- toast ---------- */
function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.setAttribute('role', type === 'err' ? 'alert' : 'status');
  t.innerHTML = `<span class="toast-ic">${type === 'err' ? '!' : '✓'}</span><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, type === 'err' ? 5200 : 2600);
}

/* ---------- model ---------- */
function model() {
  if (S.m) return S.m;
  const d = S.data, M = {};
  const role = v => ['Core', 'Elective', 'Prep', 'Exam'].includes(v) ? v : '';
  M.courses = d.courses.map(c => Object.assign({}, c, { rF: role(c.fmva), rP: role(c.fpap) }));
  M.byName = new Map(M.courses.map(c => [c.name, c]));
  M.lessons = d.mandarin.lessons;
  const lessonOf = (b, l) => M.lessons.find(x => x.book === b && x.lesson === l);
  const cst = c => !c ? '' : c.status === 'Done' ? 'selesai' : c.status === 'In progress' ? 'berjalan' : 'belum';
  const lst = l => !l ? '' : l.status === 'Selesai' ? 'selesai' : l.status === 'Proses' ? 'berjalan' : 'belum';
  const shareOf = c => (c && c.rF && c.rP) ? { FMVA: .5, FPAP: .5 } : (c && c.rP) ? { FPAP: 1 } : (c && c.rF) ? { FMVA: 1 } : { FMVA: .5, FPAP: .5 };
  M.logs = [];
  d.cfiLogs.forEach(l => {
    const c = M.byName.get(l.course);
    M.logs.push({ id: 'C' + l.row, kind: 'CFI', row: l.row, date: l.date, topic: l.course, minutes: Math.round(l.hours * 60), activity: l.activity, note: l.note, score: l.score, revisit: l.revisit, share: shareOf(c), st: cst(c) });
  });
  d.hskLogs.forEach(l => {
    M.logs.push({ id: 'H' + l.row, kind: 'HSK', row: l.row, date: l.date, book: l.book, lesson: l.lesson, topic: [l.book, l.lesson].filter(Boolean).join(' · '), minutes: l.minutes, activity: l.activity, note: l.note, score: l.score, share: { HSK: 1 }, st: lst(lessonOf(l.book, l.lesson)) });
  });
  S.queue.forEach(q => {
    const cfi = q.program === 'CFI';
    M.logs.push({ id: 'Q' + q.clientId, pending: true, kind: q.program, row: 1e9, date: q.date, topic: cfi ? q.course : [q.book, q.lesson].filter(Boolean).join(' · '), minutes: q.minutes, activity: q.activity, note: q.note, score: q.score === '' ? null : q.score, share: cfi ? shareOf(M.byName.get(q.course)) : { HSK: 1 }, st: '' });
  });
  M.logs = M.logs.filter(l => l.date).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.row - a.row);
  M.mins = (p, from, to) => M.logs.reduce((s, l) => (l.date >= from && l.date <= to) ? s + l.minutes * (p === 'all' ? 1 : (l.share[p] || 0)) : s, 0);
  M.days = new Set(M.logs.map(l => l.date));
  M.prog = {};
  PROGS.forEach(p => M.prog[p] = progInfo(M, p));
  S.m = M;
  return M;
}

function progInfo(M, P) {
  const d = S.data, t = today(), I = { P };
  if (P === 'HSK') {
    const ls = M.lessons.filter(l => /^HSK/i.test(l.book));
    const done = ls.filter(l => l.status === 'Selesai');
    I.title = (d.mandarin.label || 'HSK 3').split('(')[0].trim();
    I.pct = ls.length ? done.length / ls.length : 0;
    I.detail = `${done.length} dari ${ls.length} pelajaran`;
    I.start = d.mandarin.start; I.target = d.mandarin.target;
    I.leftUnits = ls.length - done.length; I.unit = 'pelajaran';
    const recent = done.filter(l => l.done && l.done >= addDays(t, -27)).length;
    I.pace = recent / 4;
    const vocab = d.mandarin.vocab;
    I.extra = vocab.length ? `${vocab.filter(v => v.status === 'Hafal').length} dari ${vocab.length} kosakata hafal` : '';
  } else {
    const k = P === 'FMVA' ? 'rF' : 'rP';
    const isDone = c => c.status === 'Done';
    const core = M.courses.filter(c => c[k] === 'Core'), elec = M.courses.filter(c => c[k] === 'Elective'), exam = M.courses.filter(c => c[k] === 'Exam');
    const cd = core.filter(isDone).length, ed = Math.min(3, elec.filter(isDone).length), xd = exam.filter(isDone).length;
    I.title = P === 'FMVA' ? 'FMVA' : 'FPAP';
    I.pct = (cd + ed + xd) / (core.length + 3 + exam.length || 1);
    I.detail = `Core ${cd}/${core.length} · Elektif ${ed}/3 · Ujian akhir ${xd ? 'lulus' : 'belum'}`;
    I.start = d.cfg.planStart; I.target = (P === 'FMVA' ? d.cfg.fmvaTarget : d.cfg.fpapTarget) || d.cfg.deadline;
    const pick = elec.filter(c => !isDone(c)).sort((a, b) => (a.week || 999) - (b.week || 999) || a.hours - b.hours).slice(0, 3 - ed);
    const left = core.filter(c => !isDone(c)).concat(pick);
    I.leftUnits = left.reduce((s, c) => s + c.hours, 0) * (d.cfg.factor || 1.5) + (xd < exam.length ? 10 : 0);
    I.unit = 'jam';
    I.pace = M.mins(P, addDays(t, -27), t) / 60 / 4;
    I.extra = `${left.length} kursus wajib tersisa`;
  }
  I.daysLeft = I.target ? diff(I.target, t) : null;
  I.tPct = (I.start && I.target && diff(I.target, I.start) > 0) ? clamp(diff(t, I.start) / diff(I.target, I.start)) : null;
  I.need = (I.daysLeft != null && I.leftUnits > 0) ? I.leftUnits / Math.max(I.daysLeft / 7, 1 / 7) : 0;
  I.est = (I.leftUnits > 0 && I.pace > 0) ? addDays(t, Math.ceil(I.leftUnits / I.pace * 7)) : '';
  if (I.pct >= 1 || I.leftUnits <= 0) I.verdict = { c: 'done', t: 'Selesai' };
  else if (I.daysLeft != null && I.daysLeft < 0) I.verdict = { c: 'late', t: 'Target sudah lewat' };
  else if (!I.est) I.verdict = { c: 'none', t: 'Belum ada data kecepatan' };
  else if (I.target && I.est > I.target) I.verdict = { c: 'late', t: `Perkiraan terlambat ${nf(diff(I.est, I.target))} hari` };
  else I.verdict = { c: 'ok', t: 'Kecepatan cukup' };
  return I;
}

function streak(M) {
  let d = today(), n = 0;
  if (!M.days.has(d)) d = addDays(d, -1);
  while (M.days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

function nextUp(M) {
  const d = S.data, t = today(), out = [];
  const wk = d.mandarin.weeks.find(w => w.start && w.start <= t && addDays(w.start, 6) >= t);
  const hl = M.lessons.find(l => l.status === 'Proses') || M.lessons.find(l => l.status !== 'Selesai');
  if (hl) out.push({ P: 'HSK', title: `${hl.book} · ${hl.lesson}`, sub: wk ? `${wk.week}: ${wk.focus}` : (hl.week ? 'Rencana ' + hl.week : ''), preset: { program: 'HSK', topic: 'L:' + hl.row } });
  ['FMVA', 'FPAP'].forEach(P => {
    const k = P === 'FMVA' ? 'rF' : 'rP';
    const cand = M.courses.filter(c => c[k] && c[k] !== 'Prep' && c.status !== 'Done' && c[k] !== 'Exam');
    const c = cand.find(x => x.status === 'In progress') || cand.filter(x => x.week).sort((a, b) => a.week - b.week)[0] || cand[0];
    if (c) out.push({ P, title: c.name, sub: c.status === 'In progress' ? 'Sedang berjalan' : (c.planStart ? 'Rencana mulai ' + fD(c.planStart, { day: 'numeric', month: 'short' }) : `${nf(c.hours, 1)} jam materi`), preset: { program: P, topic: 'C:' + c.row } });
  });
  return out;
}

/* ---------- komponen kecil ---------- */
const badge = p => `<span class="badge b-${p.toLowerCase()}">${PNAME[p]}</span>`;
const badges = l => Object.keys(l.share).map(badge).join('');
const pill = (s, label) => `<span class="pill s-${stClass(s)}">${esc(label || s)}</span>`;
const empty = (title, text, btn) => `<div class="empty"><div class="empty-mark" aria-hidden="true"><i></i><i></i><i></i></div><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn ? `<button class="btn primary" data-act="add">${esc(btn)}</button>` : ''}</div>`;

function logItem(l) {
  return `<button class="log" data-act="${l.pending ? 'noop' : 'edit'}" data-id="${l.id}">
    <span class="log-main"><span class="log-badges">${badges(l)}</span><span class="log-topic">${esc(l.topic)}</span></span>
    <span class="log-meta">${esc(ACT_LABEL[l.activity] || l.activity || 'Sesi belajar')}${l.score != null ? ` · skor ${nf(l.score)}%` : ''}${l.pending ? ' · <em>menunggu koneksi</em>' : ''}</span>
    ${l.note ? `<span class="log-note">${esc(l.note)}</span>` : ''}
    <span class="log-dur">${dur(l.minutes)}</span></button>`;
}

/* ---------- BERANDA ---------- */
function vBeranda() {
  const M = model(), t = today(), wk = monday(t), mo = t.slice(0, 8) + '01';
  const st = streak(M), w = M.mins('all', wk, t), m = M.mins('all', mo, t);
  const lanes = PROGS.map(p => {
    const I = M.prog[p], pct = Math.round(I.pct * 100);
    const cd = I.daysLeft == null ? 'Target belum diisi' : I.daysLeft >= 0 ? `${nf(I.daysLeft)} hari lagi` : `Lewat ${nf(-I.daysLeft)} hari`;
    return `<article class="lane l-${p.toLowerCase()}" data-act="syl" data-p="${p}">
      <div class="lane-head">${badge(p)}<span class="lane-count">${cd}</span></div>
      <div class="lane-num"><strong>${pct}%</strong><span>${esc(I.detail)}</span></div>
      <div class="track" role="img" aria-label="Progres ${pct} persen${I.tPct != null ? ', waktu terpakai ' + Math.round(I.tPct * 100) + ' persen' : ''}">
        <div class="track-fill" style="width:${Math.max(pct, 1.5)}%"></div>
        ${I.tPct != null ? `<div class="track-now" style="left:${(I.tPct * 100).toFixed(1)}%"></div>` : ''}
      </div>
      <div class="lane-foot"><span class="verdict v-${I.verdict.c}">${esc(I.verdict.t)}</span><span>Target ${fD(I.target)}</span></div>
    </article>`;
  }).join('');
  const nx = nextUp(M).map(n => `<div class="next">
      <div class="next-txt">${badge(n.P)}<strong>${esc(n.title)}</strong>${n.sub ? `<span>${esc(n.sub)}</span>` : ''}</div>
      <button class="btn small" data-act="add" data-preset='${esc(JSON.stringify(n.preset))}' aria-label="Catat sesi ${esc(n.title)}">Catat</button></div>`).join('');
  const recent = M.logs.slice(0, 3);
  return `
    <section class="stats">
      <div class="stat"><span class="stat-v">${nf(st)}<small> hari</small></span><span class="stat-l">Beruntun</span></div>
      <div class="stat"><span class="stat-v">${nf(w / 60, 1)}<small> jam</small></span><span class="stat-l">Minggu ini</span></div>
      <div class="stat"><span class="stat-v">${nf(m / 60, 1)}<small> jam</small></span><span class="stat-l">Bulan ini</span></div>
    </section>
    <section class="block">
      <h2>Menuju kelulusan</h2>
      <div class="lanes">${lanes}</div>
      <p class="hint"><span class="hint-now"></span>Garis tegak menandai porsi waktu yang sudah berjalan. Kalau warna belum menyentuh garis, progres tertinggal dari jadwal.</p>
    </section>
    ${habitCard()}
    ${nx ? `<section class="block"><h2>Lanjutkan belajar</h2><div class="card list">${nx}</div></section>` : ''}
    <section class="block">
      <div class="block-head"><h2>Sesi terakhir</h2>${M.logs.length > 3 ? '<button class="link" data-act="go" data-view="riwayat">Lihat semua</button>' : ''}</div>
      ${recent.length ? `<div class="card list">${recent.map(logItem).join('')}</div>` : empty('Belum ada sesi tercatat', 'Selesai belajar? Catat sesinya, datanya langsung masuk ke spreadsheet.', 'Catat sesi belajar')}
    </section>`;
}

/* ---------- HABIT ---------- */
function habits() { const h = S.data && S.data.habits; return (h && h.list && h.list.length && !h.error) ? h : null; }
const hOn = (h, d, idx) => (h.checks[d] || []).includes(idx);
function hStreak(h, idx) { let d = today(), n = 0; if (!hOn(h, d, idx)) d = addDays(d, -1); while (hOn(h, d, idx)) { n++; d = addDays(d, -1); } return n; }
function hWeek(h, idx) { let n = 0; for (let d = monday(today()); d <= today(); d = addDays(d, 1)) if (hOn(h, d, idx)) n++; return n; }
const hAuto = n => /mandarin|hsk|cfi|fmva|fpap/i.test(n);
const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function habitCard() {
  const h = habits();
  if (!h) return '';
  const t = today(), done = h.list.filter(x => hOn(h, t, x.idx)).length;
  return `<section class="block">
    <div class="block-head"><h2>Habit hari ini <span class="count">${done} dari ${h.list.length}</span></h2><button class="link" data-act="go" data-view="habit">Rincian</button></div>
    <div class="habits">${h.list.map(x => { const on = hOn(h, t, x.idx); return `<button class="habit ${on ? 'on' : ''}" data-act="habit" data-idx="${x.idx}" data-date="${t}" aria-pressed="${on}"><span class="tick">${CHECK}</span><span class="habit-name">${esc(x.name)}</span></button>`; }).join('')}</div>
  </section>`;
}
function vHabit() {
  const h = habits(), t = today();
  if (!h) return empty('Habit Tracker belum tersambung', 'Di spreadsheet, buka menu Study Tracker lalu Sambungkan Habit Tracker.');
  if (!S.hday || S.hday > t) S.hday = t;
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(t, -i); if (d >= h.from && d.slice(0, 4) === String(h.year)) days.push(d); }
  if (!days.includes(S.hday)) S.hday = t;
  const strip = `<div class="hdays">${days.map(d => { const n = h.list.filter(x => hOn(h, d, x.idx)).length; return `<button class="hday ${d === S.hday ? 'on' : ''}" data-act="hday" data-date="${d}" aria-pressed="${d === S.hday}"><span>${fD(d, { weekday: 'short' })}</span><strong>${pd(d).getDate()}</strong><i>${n}/${h.list.length}</i></button>`; }).join('')}</div>`;
  const wk = monday(t);
  const rows = h.list.map(x => {
    const on = hOn(h, S.hday, x.idx), w = hWeek(h, x.idx), st = hStreak(h, x.idx);
    let dots = '';
    for (let i = 0; i < 7; i++) { const d = addDays(wk, i); dots += `<i class="${d > t ? 'future' : hOn(h, d, x.idx) ? 'on' : ''}"></i>`; }
    return `<button class="hrow ${on ? 'on' : ''}" data-act="habit" data-idx="${x.idx}" data-date="${S.hday}" aria-pressed="${on}">
      <span class="tick">${CHECK}</span>
      <span class="row-txt"><strong>${esc(x.name)}</strong><span>Minggu ini ${w}${x.target ? ' dari ' + x.target : ''}${st > 1 ? ' · beruntun ' + nf(st) + ' hari' : ''}${hAuto(x.name) ? ' · otomatis mulai ' + (h.autoMinutes || 60) + ' mnt' : ''}</span></span>
      <span class="dots" aria-hidden="true">${dots}</span></button>`;
  }).join('');
  const done = h.list.filter(x => hOn(h, S.hday, x.idx)).length;
  return `<button class="link back" data-act="go" data-view="beranda">‹ Beranda</button>${strip}
    <p class="hist-sum">${S.hday === t ? 'Hari ini' : fD(S.hday, { weekday: 'long', day: 'numeric', month: 'long' })}: ${done} dari ${h.list.length} habit. Titik di kanan = Senin sampai Minggu pekan ini.</p>
    <div class="card list hlist">${rows}</div>`;
}
async function toggleHabit(idx, date) {
  const h = habits(); if (!h) return;
  const x = h.list.find(v => v.idx === idx), arr = h.checks[date] || (h.checks[date] = []), on = !arr.includes(idx);
  const apply = v => { const a = S.data.habits.checks[date] || (S.data.habits.checks[date] = []); const i = a.indexOf(idx); if (v && i < 0) a.push(idx); if (!v && i >= 0) a.splice(i, 1); };
  apply(on); render();
  setBusy(true);
  try { await api('setHabit', { date, name: x.name, on }); }
  catch (e) { if (habits()) apply(!on); toast('Habit gagal disimpan: ' + e.message, 'err'); }
  finally { setBusy(false); render(); }
}

/* ---------- RIWAYAT ---------- */
function histFiltered() {
  const M = model(), h = S.hist, t = today();
  let from = '', to = '';
  if (h.period === '7') from = addDays(t, -6);
  else if (h.period === '30') from = addDays(t, -29);
  else if (h.period === 'bulan') from = t.slice(0, 8) + '01';
  else if (h.period === 'custom') { from = h.from; to = h.to; }
  const q = h.q.trim().toLowerCase();
  return M.logs.filter(l =>
    (h.prog === 'all' || l.share[h.prog]) &&
    (!from || l.date >= from) && (!to || l.date <= to) &&
    (h.status === 'all' || l.st === h.status) &&
    (!q || (l.topic + ' ' + l.activity + ' ' + (ACT_LABEL[l.activity] || '') + ' ' + l.note).toLowerCase().includes(q)));
}
function histList() {
  const list = histFiltered(), M = model();
  if (!M.logs.length) return empty('Riwayat masih kosong', 'Sesi yang kamu catat akan muncul di sini, lengkap dengan yang sudah ada di spreadsheet.', 'Catat sesi belajar');
  if (!list.length) return empty('Tidak ada sesi yang cocok', 'Ubah kata kunci atau longgarkan filter.');
  const groups = [];
  list.forEach(l => { const g = groups[groups.length - 1]; if (g && g.date === l.date) g.items.push(l); else groups.push({ date: l.date, items: [l] }); });
  const total = list.reduce((s, l) => s + l.minutes, 0);
  return `<p class="hist-sum">${nf(list.length)} sesi · ${dur(total)}</p>` + groups.map(g =>
    `<h3 class="day">${fD(g.date, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}<span>${dur(g.items.reduce((s, l) => s + l.minutes, 0))}</span></h3><div class="card list">${g.items.map(logItem).join('')}</div>`).join('');
}
function vRiwayat() {
  const h = S.hist;
  const seg = (name, val, opts) => `<div class="seg" role="group">${opts.map(o => `<button class="${val === o[0] ? 'on' : ''}" data-act="hist" data-k="${name}" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>`;
  return `
    <div class="search"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input id="hist-q" type="search" placeholder="Cari topik, aktivitas, atau catatan" value="${esc(h.q)}" aria-label="Cari sesi"></div>
    ${seg('prog', h.prog, [['all', 'Semua'], ['HSK', 'HSK'], ['FMVA', 'FMVA'], ['FPAP', 'FPAP']])}
    <div class="filters">
      <label>Periode<select id="hist-period">${[['all', 'Semua waktu'], ['7', '7 hari terakhir'], ['30', '30 hari terakhir'], ['bulan', 'Bulan ini'], ['custom', 'Pilih tanggal']].map(o => `<option value="${o[0]}"${h.period === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>
      <label>Status topik<select id="hist-status">${[['all', 'Semua status'], ['berjalan', 'Sedang berjalan'], ['selesai', 'Selesai'], ['belum', 'Belum mulai']].map(o => `<option value="${o[0]}"${h.status === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>
    </div>
    ${h.period === 'custom' ? `<div class="filters"><label>Dari<input type="date" id="hist-from" value="${h.from}"></label><label>Sampai<input type="date" id="hist-to" value="${h.to}"></label></div>` : ''}
    <div id="hist-list">${histList()}</div>`;
}

/* ---------- SILABUS ---------- */
function bar(pct, p) { return `<div class="bar"><div class="bar-fill f-${p.toLowerCase()}" style="width:${Math.round(clamp(pct) * 100)}%"></div></div>`; }
function group(key, title, done, total, body, p) {
  const open = S.open[key] !== undefined ? S.open[key] : false;
  return `<div class="grp ${open ? 'open' : ''}">
    <button class="grp-head" data-act="toggle" data-key="${key}" aria-expanded="${open}">
      <span class="grp-title"><strong>${esc(title)}</strong><span>${nf(done)} dari ${nf(total)}</span></span>
      ${bar(total ? done / total : 0, p)}
      <svg class="chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
    </button>${open ? `<div class="grp-body">${body}</div>` : ''}</div>`;
}
function vSilabus() {
  const M = model(), d = S.data, P = S.syl, I = M.prog[P];
  const tabs = `<div class="seg big">${PROGS.map(p => `<button class="${P === p ? 'on t-' + p.toLowerCase() : ''}" data-act="syl" data-p="${p}">${p}</button>`).join('')}</div>`;
  const head = `<div class="card syl-head l-${P.toLowerCase()}">
      <div><strong class="syl-pct">${Math.round(I.pct * 100)}%</strong><span>${esc(I.detail)}</span></div>
      <div class="syl-target"><span>Target</span><strong>${fD(I.target)}</strong><span>${I.daysLeft == null ? '' : I.daysLeft >= 0 ? nf(I.daysLeft) + ' hari lagi' : 'lewat ' + nf(-I.daysLeft) + ' hari'}</span></div>
    </div>`;
  let body = '';
  if (P === 'HSK') {
    const books = [...new Set(M.lessons.map(l => l.book))];
    body = books.map(b => {
      const ls = M.lessons.filter(l => l.book === b);
      if (S.open['b:' + b] === undefined) S.open['b:' + b] = ls.some(l => l.status !== 'Selesai') && !books.slice(0, books.indexOf(b)).some(x => M.lessons.some(l => l.book === x && l.status !== 'Selesai'));
      const rows = ls.map(l => `<button class="row" data-act="status" data-kind="lesson" data-row="${l.row}">
        <span class="row-txt"><strong>${esc(l.lesson)}</strong><span>${esc(l.title || (l.week ? 'Rencana ' + l.week : ''))}${l.done ? ' · selesai ' + fD(l.done, { day: 'numeric', month: 'short' }) : ''}</span></span>${pill(l.status)}</button>`).join('');
      return group('b:' + b, b, ls.filter(l => l.status === 'Selesai').length, ls.length, rows, 'HSK');
    }).join('');
    if (d.mandarin.weeks.length) {
      const t = today();
      const rows = d.mandarin.weeks.map(w => {
        const cur = w.start && w.start <= t && addDays(w.start, 6) >= t;
        return `<button class="row ${cur ? 'cur' : ''}" data-act="status" data-kind="week" data-row="${w.row}">
          <span class="row-txt"><strong>${esc(w.week)}${cur ? ' · minggu ini' : ''}</strong><span>${esc(w.focus)}${w.start ? ' · mulai ' + fD(w.start, { day: 'numeric', month: 'short' }) : ''}</span></span>${pill(w.status)}</button>`;
      }).join('');
      body += group('weeks', 'Planner mingguan', d.mandarin.weeks.filter(w => w.status === 'Selesai' || w.status === 'Lompat').length, d.mandarin.weeks.length, rows, 'HSK');
    }
    if (d.mandarin.vocab.length) {
      const rows = `<p class="grp-note">Ketuk kata untuk mengganti status: Belum → Review → Hafal.</p><div class="vocab">` + d.mandarin.vocab.map(v =>
        `<button class="word s-${stClass(v.status)}" data-act="vocab" data-row="${v.row}" aria-label="${esc(v.hanzi)} ${esc(v.arti)}, status ${esc(v.status)}"><b lang="zh">${esc(v.hanzi)}</b><span>${esc(v.pinyin)}</span><span>${esc(v.arti)}</span><i>${esc(v.status)}</i></button>`).join('') + '</div>';
      body += group('vocab', 'Bank kosakata', d.mandarin.vocab.filter(v => v.status === 'Hafal').length, d.mandarin.vocab.length, rows, 'HSK');
    }
  } else {
    const k = P === 'FMVA' ? 'rF' : 'rP', f = d.cfg.factor || 1.5;
    const logged = {};
    d.cfiLogs.forEach(l => logged[l.course] = (logged[l.course] || 0) + l.hours);
    [['Core', 'Kursus wajib (core)'], ['Elective', 'Elektif (pilih minimal 3)'], ['Exam', 'Ujian akhir'], ['Prep', 'Persiapan (opsional)']].forEach(([r, title]) => {
      const cs = M.courses.filter(c => c[k] === r);
      if (!cs.length) return;
      if (S.open[P + r] === undefined) S.open[P + r] = r === 'Core';
      const rows = cs.map(c => {
        const pr = c.status === 'Done' ? 1 : c.hours ? clamp((logged[c.name] || 0) / (c.hours * f), 0, .95) : 0;
        const other = P === 'FMVA' ? c.rP : c.rF;
        return `<button class="row" data-act="status" data-kind="course" data-row="${c.row}">
          <span class="row-txt"><strong>${esc(c.name)}</strong><span>${c.hours ? nf(c.hours, 1) + ' jam materi' : 'Ujian'}${logged[c.name] ? ' · ' + nf(logged[c.name], 1) + ' jam tercatat' : ''}${c.score != null ? ' · nilai ' + nf(c.score) + '%' : ''}${other ? ' · juga di ' + (P === 'FMVA' ? 'FPAP' : 'FMVA') : ''}</span>${bar(pr, P)}</span>${pill(c.status, cstat(c.status))}</button>`;
      }).join('');
      body += group(P + r, title, cs.filter(c => c.status === 'Done').length, cs.length, rows, P);
    });
  }
  return tabs + head + `<div class="grps">${body}</div>`;
}

/* ---------- WAWASAN ---------- */
function topRound(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function trendBuckets() {
  const M = model(), t = today(), out = [];
  if (S.trend === 'harian') {
    for (let i = 13; i >= 0; i--) {
      const d = addDays(t, -i);
      out.push({ x: String(pd(d).getDate()), tip: fD(d, { weekday: 'long', day: 'numeric', month: 'short' }), v: PROGS.map(p => M.mins(p, d, d)) });
    }
  } else {
    const m0 = monday(t);
    for (let i = 7; i >= 0; i--) {
      const a = addDays(m0, -7 * i), b = addDays(a, 6);
      out.push({ x: fD(a, { day: 'numeric', month: 'short' }), tip: `${fD(a, { day: 'numeric', month: 'short' })} – ${fD(b, { day: 'numeric', month: 'short' })}`, v: PROGS.map(p => M.mins(p, a, b)) });
    }
  }
  return out;
}
function trendSVG(B) {
  const W = 340, H = 170, L = 30, T = 10, BT = 22, pw = W - L - 4, ph = H - T - BT;
  const maxMin = Math.max(60, ...B.map(b => b.v[0] + b.v[1] + b.v[2]));
  const step = maxMin <= 120 ? 60 : maxMin <= 240 ? 120 : Math.ceil(maxMin / 3 / 60) * 60;
  const top = Math.ceil(maxMin / step) * step;
  const y = m => T + ph - (m / top) * ph;
  const slot = pw / B.length, bw = Math.min(22, slot - 6);
  let g = '';
  for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3.5}" class="tick" text-anchor="end">${nf(v / 60, 1)}</text>`;
  B.forEach((b, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    let acc = 0;
    const segs = b.v.map((m, k) => ({ m, k })).filter(s => s.m > 0);
    segs.forEach((s, j) => {
      const y1 = y(acc + s.m), h = Math.max(1.5, y(acc) - y1 - (j < segs.length - 1 ? 2 : 0));
      const yy = y(acc) - h;
      g += j === segs.length - 1 ? `<path d="${topRound(x, yy, bw, h, 4)}" class="f-${PROGS[s.k].toLowerCase()} ${S.sel >= 0 && S.sel !== i ? 'dim' : ''}"/>` : `<rect x="${x}" y="${yy}" width="${bw}" height="${h}" class="f-${PROGS[s.k].toLowerCase()} ${S.sel >= 0 && S.sel !== i ? 'dim' : ''}"/>`;
      acc += s.m;
    });
    const show = B.length <= 8 || i % 2 === (B.length - 1) % 2;
    if (show) g += `<text x="${x + bw / 2}" y="${H - 6}" class="tick ${S.sel === i ? 'on' : ''}" text-anchor="middle">${esc(b.x)}</text>`;
    g += `<rect x="${L + slot * i}" y="${T}" width="${slot}" height="${ph + BT}" fill="transparent" data-act="bar" data-i="${i}" tabindex="0" role="button" aria-label="${esc(b.tip)}: ${dur(b.v[0] + b.v[1] + b.v[2])}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Grafik jam belajar ${S.trend}">${g}<line x1="${L}" x2="${W - 4}" y1="${y(0)}" y2="${y(0)}" class="axis"/></svg>`;
}
function vWawasan() {
  const M = model(), t = today();
  if (!M.logs.length) return empty('Belum ada data untuk dianalisis', 'Catat beberapa sesi dulu. Grafik distribusi, tren, dan perkiraan selesai akan muncul di sini.', 'Catat sesi belajar');
  const from = S.dist ? addDays(t, -(S.dist - 1)) : '0000-00-00';
  const dv = PROGS.map(p => M.mins(p, from, t)), dt = dv[0] + dv[1] + dv[2];
  const distBar = dt ? `<div class="dist" role="img" aria-label="Distribusi waktu belajar">${PROGS.map((p, i) => dv[i] ? `<div class="f-${p.toLowerCase()}" style="flex:${dv[i]}"></div>` : '').join('')}</div>` : '<p class="muted">Tidak ada sesi pada periode ini.</p>';
  const legend = `<table class="legend"><tbody>${PROGS.map((p, i) => `<tr><td><span class="sw f-${p.toLowerCase()}"></span>${PNAME[p]}</td><td>${hrs(dv[i])}</td><td>${dt ? Math.round(dv[i] / dt * 100) : 0}%</td></tr>`).join('')}</tbody></table>`;
  const B = trendBuckets(), sel = S.sel >= 0 ? B[S.sel] : null;
  const readout = sel ? `<strong>${esc(sel.tip)}</strong> ${sel.v.some(v => v) ? PROGS.map((p, i) => sel.v[i] ? `${PNAME[p]} ${dur(sel.v[i])}` : '').filter(Boolean).join(' · ') : 'tidak ada sesi'}` : 'Ketuk batang untuk melihat rinciannya.';
  const m30 = M.mins('all', addDays(t, -29), t);
  let active = 0; for (let i = 0; i < 30; i++) if (M.days.has(addDays(t, -i))) active++;
  const wk = monday(t);
  const week = PROGS.filter(p => M.prog[p].pct < 1).map(p => ({ p, m: M.mins(p, wk, t) })).sort((a, b) => a.m - b.m);
  const least = !week.length ? 'Semua program sudah selesai.' : week.every(x => x.m === 0) ? 'Belum ada sesi minggu ini di program mana pun.' : `${PNAME[week[0].p]} paling jarang disentuh minggu ini (${week[0].m ? dur(week[0].m) : 'belum ada sesi'}).`;
  const last = PROGS.map(p => { const l = M.logs.find(x => x.share[p]); const n = l ? diff(t, l.date) : null; return `${PNAME[p]} ${n == null ? 'belum pernah' : n === 0 ? 'hari ini' : n === 1 ? 'kemarin' : nf(n) + ' hari lalu'}`; }).join(' · ');
  const pace = PROGS.map(p => {
    const I = M.prog[p], u = I.unit;
    const rows = I.pct >= 1 ? '<p>Semua syarat sudah selesai.</p>' : `
      <dl><div><dt>Perkiraan selesai</dt><dd>${I.est ? fD(I.est) : 'Belum bisa dihitung'}</dd></div>
      <div><dt>Target</dt><dd>${fD(I.target)}</dd></div>
      <div><dt>Kecepatan 4 minggu terakhir</dt><dd>${nf(I.pace, 1)} ${u}/minggu</dd></div>
      <div><dt>Kebutuhan agar tepat waktu</dt><dd>${I.daysLeft != null && I.daysLeft >= 0 ? nf(I.need, 1) + ' ' + u + '/minggu' : '–'}</dd></div>
      <div><dt>Sisa</dt><dd>${nf(I.leftUnits, 1)} ${u}${I.extra ? ' · ' + esc(I.extra) : ''}</dd></div></dl>`;
    return `<div class="card pace l-${p.toLowerCase()}"><div class="pace-head">${badge(p)}<span class="verdict v-${I.verdict.c}">${esc(I.verdict.t)}</span></div>${rows}</div>`;
  }).join('');
  const seg = (act, val, opts) => `<div class="seg small">${opts.map(o => `<button class="${val === o[0] ? 'on' : ''}" data-act="${act}" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>`;
  return `
    <section class="block"><div class="block-head"><h2>Pembagian waktu</h2>${seg('dist', S.dist, [[7, '7 hari'], [30, '30 hari'], [0, 'Semua']])}</div>
      <div class="card pad">${distBar}${legend}<p class="muted small-note">Kursus yang berlaku untuk FMVA dan FPAP dibagi rata ke keduanya.</p></div></section>
    <section class="block"><div class="block-head"><h2>Tren jam belajar</h2>${seg('trend', S.trend, [['harian', 'Harian'], ['mingguan', 'Mingguan']])}</div>
      <div class="card pad"><div class="legend-row">${PROGS.map(p => `<span><span class="sw f-${p.toLowerCase()}"></span>${PNAME[p]}</span>`).join('')}<span class="unit">jam</span></div>${trendSVG(B)}<p class="readout">${readout}</p></div></section>
    <section class="block"><h2>Evaluasi</h2>
      <div class="card list facts">
        <div><span>Rata-rata 30 hari terakhir</span><strong>${nf(m30 / 30)} mnt per hari</strong><small>${nf(active)} dari 30 hari ada sesi${active ? ', rata-rata ' + dur(m30 / active) + ' per hari aktif' : ''}</small></div>
        <div><span>Perlu perhatian</span><strong>${esc(least)}</strong></div>
        <div><span>Terakhir belajar</span><strong>${esc(last)}</strong></div>
      </div></section>
    <section class="block"><h2>Perkiraan selesai</h2><div class="paces">${pace}</div>
      <p class="muted small-note">FMVA dan FPAP dihitung dari jam materi tersisa × ${nf(S.data.cfg.factor || 1.5, 1)} ditambah 10 jam review ujian akhir. HSK dihitung dari jumlah pelajaran yang selesai.</p></section>`;
}

/* ---------- SETUP ---------- */
function vSetup() {
  return `<div class="setup">
    <div class="setup-mark" aria-hidden="true"><i></i><i></i><i></i></div>
    <h2>Sambungkan ke spreadsheet</h2>
    <p>Tempel kode sambungan dari menu <b>Study Tracker › Tampilkan kode akses</b> di Google Sheets. Cukup sekali di HP ini.</p>
    <form id="setup-form" novalidate>
      <label>URL aplikasi web Apps Script<textarea id="su-url" rows="3" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea></label>
      <label>Kode akses<input id="su-key" type="password" autocomplete="off" placeholder="Terisi otomatis jika menempel kode sambungan"></label>
      <p id="su-err" class="err" hidden></p>
      <button class="btn primary block" type="submit">Sambungkan</button>
    </form></div>`;
}
async function doSetup(ev) {
  ev.preventDefault();
  let url = $('#su-url').value.trim(), key = $('#su-key').value.trim();
  if (url.includes('|')) { const p = url.split('|'); url = p[0].trim(); key = key || p[1].trim(); }
  const err = $('#su-err');
  const fail = m => { err.textContent = m; err.hidden = false; };
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) return fail('URL harus diawali https://script.google.com/ dan diakhiri /exec.');
  if (!key) return fail('Kode akses belum diisi.');
  err.hidden = true;
  S.conn = { url, key };
  setBusy(true);
  try {
    await api('load');
    LS.set('st.conn', S.conn);
    toast('Tersambung ke "' + S.data.sheetName + '".', 'ok');
  } catch (e) {
    S.conn = null;
    fail(e.network ? 'Tidak bisa menghubungi server. Periksa koneksi internet dan URL.' : e.message);
  } finally { setBusy(false); if (S.conn) render(); }
}

/* ---------- render ---------- */
const TITLES = { beranda: 'Beranda', riwayat: 'Riwayat', silabus: 'Silabus & target', wawasan: 'Wawasan', habit: 'Habit harian' };
function render() {
  const v = $('#view');
  document.body.classList.toggle('no-conn', !S.conn);
  $('#today').textContent = fD(today(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (!S.conn) { $('#title').textContent = 'Study Tracker'; v.innerHTML = vSetup(); return; }
  $('#title').textContent = TITLES[S.view];
  $$('.nav-item').forEach(b => { const on = b.dataset.view === (S.view === 'habit' ? 'beranda' : S.view); b.classList.toggle('on', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  if (!S.data) { v.innerHTML = '<div class="skeleton"><i></i><i></i><i></i><p>Memuat data dari Google Sheets…</p></div>'; return; }
  const y = window.scrollY;
  v.innerHTML = S.view === 'beranda' ? vBeranda() : S.view === 'riwayat' ? vRiwayat() : S.view === 'silabus' ? vSilabus() : S.view === 'habit' ? vHabit() : vWawasan();
  window.scrollTo(0, y);
  chip();
}
function go(view) { S.view = view; S.sel = -1; render(); window.scrollTo(0, 0); }

/* ---------- sheet (panel bawah) ---------- */
function openSheet(html) {
  const s = $('#sheet');
  s.innerHTML = `<div class="sheet-grab" aria-hidden="true"></div>` + html;
  s.hidden = false; $('#scrim').hidden = false;
  document.body.classList.add('lock');
  requestAnimationFrame(() => { s.classList.add('in'); $('#scrim').classList.add('in'); });
}
function closeSheet() {
  const s = $('#sheet');
  s.classList.remove('in'); $('#scrim').classList.remove('in');
  document.body.classList.remove('lock');
  S.form = null;
  setTimeout(() => { s.hidden = true; $('#scrim').hidden = true; s.innerHTML = ''; }, 220);
}

/* ---------- form catat sesi ---------- */
function topicOptions(P) {
  const M = model();
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const grp = (label, arr) => arr.length ? `<optgroup label="${esc(label)}">${arr.join('')}</optgroup>` : '';
  if (P === 'HSK') {
    const lab = l => `${l.lesson}${l.title ? ' — ' + l.title : ''}${l.status === 'Selesai' ? ' ✓' : ''}`;
    const cont = M.lessons.filter(l => l.status === 'Proses').concat(M.lessons.filter(l => l.status === 'Belum').slice(0, 1));
    const used = new Set(cont.map(l => l.row));
    let h = grp('Lanjutkan', cont.map(l => opt('L:' + l.row, `${l.book} · ${lab(l)}`)));
    [...new Set(M.lessons.map(l => l.book))].forEach(b => h += grp(b, M.lessons.filter(l => l.book === b && !used.has(l.row)).map(l => opt('L:' + l.row, lab(l)))));
    h += grp('Topik umum', HSK_TOPICS.map(t => opt('T:' + t, t)));
    return h + opt('X', 'Topik lain (ketik sendiri)…');
  }
  const k = P === 'FMVA' ? 'rF' : 'rP';
  const cs = M.courses.filter(c => c[k]);
  const lab = c => `${c.name}${c.status === 'Done' ? ' ✓' : ''}`;
  const running = cs.filter(c => c.status === 'In progress');
  const planned = cs.filter(c => c.status !== 'Done' && c.status !== 'In progress' && c.week).sort((a, b) => a.week - b.week).slice(0, 4);
  const used = new Set(running.concat(planned).map(c => c.row));
  let h = grp('Sedang berjalan', running.map(c => opt('C:' + c.row, lab(c)))) + grp('Berikutnya di rencana', planned.map(c => opt('C:' + c.row, lab(c))));
  [['Core', 'Kursus wajib'], ['Elective', 'Elektif'], ['Exam', 'Ujian akhir'], ['Prep', 'Persiapan']].forEach(([r, t]) => h += grp(t, cs.filter(c => c[k] === r && !used.has(c.row)).map(c => opt('C:' + c.row, lab(c)))));
  return h;
}
function actList(P) { return (P === 'HSK' ? HSK_ACTS : (S.data.cfiActivities || [])).slice(); }

function openForm(preset, log) {
  const last = LS.get('st.last', {});
  const F = S.form = { mode: log ? 'edit' : 'add', log: log || null, program: 'HSK', topic: '', custom: '', activity: '', minutes: 30, status: 'proses', date: today(), score: '', note: '' };
  if (log) {
    const M = model();
    F.date = log.date; F.minutes = log.minutes; F.activity = log.activity; F.note = log.note; F.score = log.score == null ? '' : log.score;
    if (log.kind === 'CFI') {
      const c = M.byName.get(log.topic);
      F.program = c && !c.rF ? 'FPAP' : 'FMVA'; F.topic = c ? 'C:' + c.row : '';
    } else {
      F.program = 'HSK';
      const l = M.lessons.find(x => x.book === log.book && x.lesson === log.lesson);
      if (l) F.topic = 'L:' + l.row; else if (HSK_TOPICS.includes(log.lesson)) F.topic = 'T:' + log.lesson; else { F.topic = 'X'; F.custom = log.lesson; }
    }
  } else {
    F.program = (preset && preset.program) || last.program || 'HSK';
    F.topic = (preset && preset.topic) || '';
    if (last.minutes) F.minutes = last.minutes;
  }
  const chips = [15, 30, 45, 60, 90, 120];
  openSheet(`
    <form id="log-form" novalidate>
      <div class="sheet-head"><h2>${log ? 'Ubah sesi' : 'Catat sesi belajar'}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Tutup">✕</button></div>
      <fieldset><legend>Jalur belajar</legend><div class="seg big" id="f-prog">${PROGS.map(p => `<button type="button" data-p="${p}">${p}</button>`).join('')}</div></fieldset>
      <label class="field">Modul / topik<select id="f-topic"></select></label>
      <label class="field" id="f-custom-wrap" hidden>Nama topik<input id="f-custom" type="text" maxlength="120" placeholder="Contoh: Latihan menulis hanzi" value="${esc(F.custom)}"></label>
      <p class="err" id="e-topic" hidden>Pilih atau isi topik dulu.</p>
      <fieldset><legend>Jenis aktivitas</legend><div class="chips" id="f-act"></div></fieldset>
      <fieldset><legend>Durasi</legend>
        <div class="chips" id="f-dur">${chips.map(c => `<button type="button" data-m="${c}">${c < 60 ? c + ' mnt' : (c / 60 + ' jam').replace('.', ',')}</button>`).join('')}</div>
        <label class="inline">Atau ketik<input id="f-min" type="number" inputmode="numeric" min="1" max="1440" step="1" value="${F.minutes}"><span>menit</span></label>
        <p class="err" id="e-min" hidden>Durasi harus antara 1 dan 1.440 menit.</p></fieldset>
      ${log ? '' : `<fieldset id="f-status-wrap"><legend>Status topik</legend><div class="seg" id="f-status"><button type="button" data-s="proses">Masih berjalan</button><button type="button" data-s="selesai">Selesai</button></div></fieldset>`}
      <div class="two">
        <label class="field">Tanggal<input id="f-date" type="date" max="${today()}" value="${F.date}"></label>
        <label class="field">Skor kuis (%)<input id="f-score" type="number" inputmode="decimal" min="0" max="100" placeholder="Opsional" value="${F.score}"></label>
      </div>
      <p class="err" id="e-date" hidden>Tanggal belum diisi atau berada di masa depan.</p>
      <p class="err" id="e-score" hidden>Skor harus antara 0 dan 100.</p>
      <label class="field">Catatan singkat<textarea id="f-note" rows="2" maxlength="500" placeholder="Apa yang dipelajari atau perlu diulang">${esc(F.note)}</textarea></label>
      <div class="sheet-actions">
        <button class="btn primary block" type="submit" id="f-save">${log ? 'Simpan perubahan' : 'Simpan sesi'}</button>
        ${log ? '<button class="btn danger-ghost block" type="button" data-act="del-ask">Hapus sesi</button>' : ''}
      </div>
    </form>`);
  paintForm(true);
}
function paintForm(full) {
  const F = S.form;
  $$('#f-prog button').forEach(b => { const on = b.dataset.p === F.program; b.className = on ? 'on t-' + F.program.toLowerCase() : ''; b.setAttribute('aria-pressed', on); });
  if (full) {
    const sel = $('#f-topic');
    sel.innerHTML = topicOptions(F.program);
    const last = LS.get('st.last', {});
    const want = F.topic || (last.topics || {})[F.program] || '';
    if (want && $$('option', sel).some(o => o.value === want)) sel.value = want; else sel.selectedIndex = 0;
    F.topic = sel.value;
    const acts = actList(F.program);
    if (!acts.includes(F.activity)) F.activity = ((last.acts || {})[F.program] && acts.includes(last.acts[F.program])) ? last.acts[F.program] : acts[0];
    if (F.mode === 'edit' && F.log.activity && !acts.includes(F.log.activity) && F.log.kind === (F.program === 'HSK' ? 'HSK' : 'CFI')) { acts.unshift(F.log.activity); F.activity = F.log.activity; }
    $('#f-act').innerHTML = acts.map(a => `<button type="button" data-a="${esc(a)}">${esc(ACT_LABEL[a] || a)}</button>`).join('');
  }
  $('#f-custom-wrap').hidden = F.topic !== 'X';
  $$('#f-act button').forEach(b => { const on = b.dataset.a === F.activity; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $$('#f-dur button').forEach(b => b.classList.toggle('on', Number(b.dataset.m) === Number(F.minutes)));
  $$('#f-status button').forEach(b => b.classList.toggle('on', b.dataset.s === F.status));
  const sw = $('#f-status-wrap');
  if (sw) sw.hidden = F.program === 'HSK' && !/^L:/.test(F.topic);
}
async function submitForm(ev) {
  ev.preventDefault();
  const F = S.form, M = model();
  F.minutes = Number($('#f-min').value); F.date = $('#f-date').value; F.note = $('#f-note').value.trim();
  F.custom = $('#f-custom').value.trim(); F.topic = $('#f-topic').value;
  const sc = $('#f-score').value.trim();
  const bad = {
    topic: !F.topic || (F.topic === 'X' && !F.custom),
    min: !(F.minutes >= 1 && F.minutes <= 1440),
    date: !F.date || F.date > today(),
    score: sc !== '' && !(Number(sc) >= 0 && Number(sc) <= 100)
  };
  Object.keys(bad).forEach(k => $('#e-' + k).hidden = !bad[k]);
  if (Object.values(bad).some(Boolean)) { const first = $('#log-form .err:not([hidden])'); if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const e = { program: F.program === 'HSK' ? 'HSK' : 'CFI', date: F.date, minutes: Math.round(F.minutes), activity: F.activity, note: F.note, score: sc === '' ? '' : Number(sc), status: F.mode === 'add' ? F.status : '' };
  if (e.program === 'CFI') {
    const c = M.courses.find(x => 'C:' + x.row === F.topic);
    e.course = c.name;
  } else if (/^L:/.test(F.topic)) {
    const l = M.lessons.find(x => 'L:' + x.row === F.topic);
    e.book = l.book; e.lesson = l.lesson; e.lessonRow = l.row;
  } else { e.book = ''; e.lesson = F.topic === 'X' ? F.custom : F.topic.slice(2); e.status = ''; }
  const last = LS.get('st.last', {});
  last.program = F.program; last.minutes = e.minutes;
  last.topics = Object.assign({}, last.topics, { [F.program]: F.topic === 'X' ? '' : F.topic });
  last.acts = Object.assign({}, last.acts, { [F.program]: F.activity });
  LS.set('st.last', last);
  const btn = $('#f-save'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  setBusy(true);
  try {
    if (F.mode === 'edit') {
      await api('updateLog', { row: F.log.row, expect: { date: F.log.date, topic: F.log.kind === 'CFI' ? F.log.topic : F.log.lesson }, entry: e });
      toast('Perubahan tersimpan ke Google Sheets.', 'ok');
    } else {
      e.clientId = uid();
      try { await api('addLog', { entry: e }); toast(`Sesi ${dur(e.minutes)} tersimpan ke Google Sheets.`, 'ok'); const w = (S.data.warnings || []).find(x => /Habit Tracker/.test(x)); if (w) toast(w, 'err'); }
      catch (err) {
        if (!err.network) throw err;
        S.queue.push(e); LS.set('st.queue', S.queue); S.m = null;
        toast('Tidak ada koneksi. Sesi disimpan di HP dan dikirim otomatis saat online.', 'err');
      }
    }
    closeSheet();
  } catch (err) {
    toast('Gagal menyimpan: ' + err.message, 'err');
    btn.disabled = false; btn.textContent = F.mode === 'edit' ? 'Simpan perubahan' : 'Simpan sesi';
    if (err.code === 'STALE') { closeSheet(); refresh(true); }
  } finally { setBusy(false); render(); }
}
function askDelete() {
  const l = S.form.log;
  $('.sheet-actions').innerHTML = `<p class="confirm">Hapus sesi <b>${esc(l.topic)}</b> (${dur(l.minutes)}, ${fD(l.date)})? Baris ini juga terhapus dari spreadsheet dan tidak bisa dikembalikan dari aplikasi.</p>
    <button class="btn danger block" type="button" data-act="del-yes">Ya, hapus sesi</button><button class="btn ghost block" type="button" data-act="close">Batal</button>`;
}
async function doDelete() {
  const l = S.form.log;
  closeSheet();
  await run('deleteLog', { program: l.kind, row: l.row, expect: { date: l.date, topic: l.kind === 'CFI' ? l.topic : l.lesson } }, 'Sesi dihapus.');
}

/* ---------- ubah status silabus ---------- */
function openStatus(kind, row) {
  const M = model(), d = S.data;
  let title, sub, cur, opts, expect, preset = null;
  if (kind === 'course') {
    const c = M.courses.find(x => x.row === row);
    title = c.name; sub = `${c.hours ? nf(c.hours, 1) + ' jam materi' : 'Ujian'}${c.notes ? ' · ' + c.notes : ''}`; cur = c.status; expect = c.name;
    opts = ['Not started', 'In progress', 'Done', 'Retake'].map(s => [s, cstat(s)]);
    preset = { program: S.syl === 'HSK' ? (c.rF ? 'FMVA' : 'FPAP') : S.syl, topic: 'C:' + c.row };
    S.st = { kind, row, expect, status: cur, score: c.score, exam: c.rF === 'Exam' || c.rP === 'Exam' };
  } else if (kind === 'lesson') {
    const l = M.lessons.find(x => x.row === row);
    title = `${l.book} · ${l.lesson}`; sub = l.title || (l.week ? 'Rencana ' + l.week : ''); cur = l.status; expect = l.book + '|' + l.lesson;
    opts = ['Belum', 'Proses', 'Selesai'].map(s => [s, s]);
    preset = { program: 'HSK', topic: 'L:' + l.row };
    S.st = { kind, row, expect, status: cur };
  } else {
    const w = d.mandarin.weeks.find(x => x.row === row);
    title = `Minggu ${w.week}`; sub = w.focus; cur = w.status; expect = w.week;
    opts = ['Belum', 'Proses', 'Selesai', 'Lompat'].map(s => [s, s]);
    S.st = { kind, row, expect, status: cur };
  }
  openSheet(`
    <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Tutup">✕</button></div>
    ${sub ? `<p class="muted">${esc(sub)}</p>` : ''}
    <fieldset><legend>Status</legend><div class="seg wrap" id="st-seg">${opts.map(o => `<button type="button" data-s="${esc(o[0])}" class="${o[0] === cur ? 'on' : ''}">${esc(o[1])}</button>`).join('')}</div></fieldset>
    <div id="st-done" class="two" ${kind === 'week' ? 'hidden' : ''}>
      <label class="field">Tanggal<input id="st-date" type="date" max="${today()}" value="${today()}"></label>
      ${kind === 'course' ? `<label class="field">Nilai ujian (%)<input id="st-score" type="number" inputmode="decimal" min="0" max="100" placeholder="Opsional" value="${S.st.score == null ? '' : S.st.score}"></label>` : ''}
    </div>
    <p class="muted small-note" id="st-hint"></p>
    <div class="sheet-actions">
      <button class="btn primary block" type="button" data-act="st-save">Simpan status</button>
      ${preset ? `<button class="btn ghost block" type="button" data-act="add" data-preset='${esc(JSON.stringify(preset))}'>Catat sesi untuk topik ini</button>` : ''}
    </div>`);
  paintStatus();
}
function paintStatus() {
  const st = S.st, done = st.status === 'Done' || st.status === 'Selesai';
  $$('#st-seg button').forEach(b => b.classList.toggle('on', b.dataset.s === st.status));
  if (st.kind !== 'week') $('#st-done').hidden = !(done || st.status === 'Proses');
  const sc = $('#st-score'), hint = $('#st-hint');
  let h = '';
  if (st.kind === 'course' && done && sc && sc.value !== '') {
    const min = st.exam ? 70 : 80;
    if (Number(sc.value) < min) h = `Nilai di bawah batas lulus ${min}%. Pilih "Ulang" kalau ujiannya perlu diulang.`;
  }
  hint.textContent = h;
}
async function saveStatus() {
  const st = S.st, date = $('#st-date') ? $('#st-date').value : '', sc = $('#st-score') ? $('#st-score').value.trim() : '';
  if (sc !== '' && !(Number(sc) >= 0 && Number(sc) <= 100)) return toast('Nilai harus antara 0 dan 100.', 'err');
  if (date && date > today()) return toast('Tanggal tidak boleh di masa depan.', 'err');
  closeSheet();
  await run('setStatus', { kind: st.kind, row: st.row, expect: st.expect, status: st.status, date: date || today(), score: sc === '' ? '' : Number(sc) }, 'Status tersimpan ke Google Sheets.');
}
async function cycleVocab(row) {
  const v = S.data.mandarin.vocab.find(x => x.row === row);
  const order = ['Belum', 'Review', 'Hafal'], next = order[(order.indexOf(v.status) + 1) % 3], prev = v.status;
  v.status = next; S.m = null; render();
  setBusy(true);
  try { await api('setStatus', { kind: 'vocab', row, expect: v.hanzi, status: next }); }
  catch (e) { const w = S.data.mandarin.vocab.find(x => x.row === row); if (w) w.status = prev; S.m = null; toast('Status kata gagal disimpan: ' + e.message, 'err'); }
  finally { setBusy(false); render(); }
}

/* ---------- pengaturan ---------- */
function openSettings() {
  const d = S.data;
  openSheet(`
    <div class="sheet-head"><h2>Pengaturan</h2><button type="button" class="icon-btn" data-act="close" aria-label="Tutup">✕</button></div>
    <div class="card list facts">
      <div><span>Spreadsheet tersambung</span><strong>${esc(d ? d.sheetName : '–')}</strong>${d ? `<small>${d.harian ? 'Menit Mandarin ikut ditulis ke tab Harian.' : 'Tab Harian tidak ada di file ini.'}</small>` : ''}</div>
      <div><span>Habit Tracker</span><strong>${d && d.habits ? esc(d.habits.error ? 'Bermasalah: ' + d.habits.error : d.habits.name + ' (' + d.habits.list.length + ' habit)') : 'Belum tersambung'}</strong>${d && !d.habits ? '<small>Di spreadsheet, buka menu Study Tracker lalu Sambungkan Habit Tracker.</small>' : ''}</div>
      ${d && d.warnings.length ? `<div><span>Catatan dari spreadsheet</span><strong>${d.warnings.map(esc).join('<br>')}</strong></div>` : ''}
      <div><span>Pasang di layar utama</span><small>Android (Chrome): menu ⋮ lalu "Tambahkan ke layar utama". iPhone (Safari): tombol Bagikan lalu "Tambahkan ke Layar Utama".</small></div>
    </div>
    <div class="sheet-actions">
      <button class="btn ghost block" type="button" data-act="reload">Muat ulang data</button>
      <button class="btn danger-ghost block" type="button" data-act="logout-ask">Putuskan sambungan di HP ini</button>
    </div>`);
}

/* ---------- event ---------- */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (ev.target.id === 'scrim') return closeSheet();
  const navb = ev.target.closest('.nav-item');
  if (navb) return go(navb.dataset.view);
  if (ev.target.closest('#fab')) return openForm();
  if (ev.target.closest('#btn-refresh')) return refresh();
  if (ev.target.closest('#btn-settings')) return openSettings();

  // kontrol di dalam form
  const F = S.form;
  if (F) {
    const b = ev.target.closest('button');
    if (b && b.closest('#f-prog')) { F.program = b.dataset.p; F.topic = ''; return paintForm(true); }
    if (b && b.closest('#f-act')) { F.activity = b.dataset.a; return paintForm(); }
    if (b && b.closest('#f-dur')) { F.minutes = Number(b.dataset.m); $('#f-min').value = F.minutes; return paintForm(); }
    if (b && b.closest('#f-status')) { F.status = b.dataset.s; return paintForm(); }
  }
  const sb = ev.target.closest('#st-seg button');
  if (sb) { S.st.status = sb.dataset.s; return paintStatus(); }

  if (!el) return;
  const a = el.dataset.act;
  if (a === 'add') { const p = el.dataset.preset ? JSON.parse(el.dataset.preset) : null; if (!$('#sheet').hidden) { closeSheet(); setTimeout(() => openForm(p), 240); } else openForm(p); }
  else if (a === 'edit') { const l = model().logs.find(x => x.id === el.dataset.id); if (l) openForm(null, l); }
  else if (a === 'close') closeSheet();
  else if (a === 'go') go(el.dataset.view);
  else if (a === 'syl') { S.syl = el.dataset.p; go('silabus'); }
  else if (a === 'toggle') { S.open[el.dataset.key] = !S.open[el.dataset.key]; render(); }
  else if (a === 'status') openStatus(el.dataset.kind, Number(el.dataset.row));
  else if (a === 'vocab') cycleVocab(Number(el.dataset.row));
  else if (a === 'habit') toggleHabit(Number(el.dataset.idx), el.dataset.date);
  else if (a === 'hday') { S.hday = el.dataset.date; render(); }
  else if (a === 'hist') { S.hist[el.dataset.k] = el.dataset.v; render(); }
  else if (a === 'dist') { S.dist = Number(el.dataset.v); render(); }
  else if (a === 'trend') { S.trend = el.dataset.v; S.sel = -1; render(); }
  else if (a === 'bar') { const i = Number(el.dataset.i); S.sel = S.sel === i ? -1 : i; render(); }
  else if (a === 'del-ask') askDelete();
  else if (a === 'del-yes') doDelete();
  else if (a === 'st-save') saveStatus();
  else if (a === 'reload') { closeSheet(); refresh(); }
  else if (a === 'logout-ask') { $('.sheet-actions').innerHTML = `<p class="confirm">Putuskan sambungan? Data di spreadsheet tetap aman. Untuk memakai lagi, tempel ulang kode sambungan.</p><button class="btn danger block" type="button" data-act="logout">Ya, putuskan</button><button class="btn ghost block" type="button" data-act="close">Batal</button>`; }
  else if (a === 'logout') { ['st.conn', 'st.data', 'st.queue', 'st.last'].forEach(LS.del); S.conn = null; S.data = null; S.queue = []; S.m = null; closeSheet(); render(); }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.dataset && ev.target.dataset.act === 'bar') { ev.preventDefault(); ev.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
document.addEventListener('submit', ev => {
  if (ev.target.id === 'log-form') submitForm(ev);
  else if (ev.target.id === 'setup-form') doSetup(ev);
});
document.addEventListener('input', ev => {
  const id = ev.target.id;
  if (id === 'hist-q') { S.hist.q = ev.target.value; $('#hist-list').innerHTML = histList(); }
  else if (id === 'f-min' && S.form) { S.form.minutes = Number(ev.target.value); paintForm(); }
  else if (id === 'st-score') paintStatus();
  else if (id === 'su-url' && ev.target.value.includes('|')) { const p = ev.target.value.split('|'); ev.target.value = p[0].trim(); $('#su-key').value = (p[1] || '').trim(); }
});
document.addEventListener('change', ev => {
  const id = ev.target.id, v = ev.target.value;
  if (id === 'hist-period') { S.hist.period = v; render(); }
  else if (id === 'hist-status') { S.hist.status = v; render(); }
  else if (id === 'hist-from') { S.hist.from = v; render(); }
  else if (id === 'hist-to') { S.hist.to = v; render(); }
  else if (id === 'f-topic' && S.form) { S.form.topic = v; paintForm(); if (v === 'X') $('#f-custom').focus(); }
});
window.addEventListener('online', () => refresh(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.conn && Date.now() - (S.lastLoad || 0) > 5 * 60e3) { S.lastLoad = Date.now(); refresh(true); } });

/* ---------- mulai ---------- */
render();
if (S.conn) { S.lastLoad = Date.now(); refresh(true); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
