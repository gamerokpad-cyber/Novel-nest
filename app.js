// ============================================================================
// NovelNest — Candy Pop Library + Cream Reader
// ============================================================================

// ── Config ──────────────────────────────────────────
const SB_URL = 'https://gozidudllzbooltohuuy.supabase.co';
const SB_KEY = 'sb_publishable_NCFHa8a0ehvMC9iM-xH_Eg_e2Fgoyap';
const BUCKET = 'novels';
const H = { 'apikey': SB_KEY, 'Content-Type': 'application/json' };

// ── Supabase REST helpers ──────────────────────────
async function dbGet(table, q='') {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, { headers: H });
  if (!r.ok) throw new Error(`DB GET ${r.status}: ${await r.text()}`);
  return r.json();
}
async function dbPost(table, body, prefer='') {
  const h = { ...H }; if (prefer) h['Prefer'] = prefer;
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method:'POST', headers:h, body:JSON.stringify(body) });
  if (!r.ok) throw new Error(`DB POST ${r.status}: ${await r.text()}`);
  return r.json().catch(()=>null);
}
async function dbPatch(table, q, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, { method:'PATCH', headers:H, body:JSON.stringify(body) });
  if (!r.ok) throw new Error(`DB PATCH ${r.status}: ${await r.text()}`);
}
async function dbDelete(table, q) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, { method:'DELETE', headers:H });
  if (!r.ok) throw new Error(`DB DELETE ${r.status}: ${await r.text()}`);
}
async function storageUpload(path, file) {
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method:'POST', headers:{ 'apikey':SB_KEY, 'Content-Type':file.type }, body:file });
  if (!r.ok) throw new Error(`Storage upload ${r.status}: ${await r.text()}`);
}
async function storageDelete(path) {
  await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, { method:'DELETE', headers:H });
}
async function storageSignedUrl(path) {
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method:'POST', headers:H, body:JSON.stringify({ expiresIn:3600 }) });
  if (!r.ok) throw new Error(`SignedURL ${r.status}`);
  const d = await r.json();
  return `${SB_URL}/storage/v1${d.signedURL}`;
}

// ── PDF.js ─────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Device ID ──────────────────────────────────────
let deviceId = localStorage.getItem('nn_device');
if (!deviceId) { deviceId = 'dev_' + crypto.randomUUID(); localStorage.setItem('nn_device', deviceId); }

// ── Screen bucket (แยก scale ตามขนาดหน้าจอ) ─────────
function getScreenBucket() {
  const w = window.innerWidth;
  if (w < 768)  return 'sm';   // มือถือ
  if (w < 1280) return 'md';   // แท็บเล็ต
  return 'lg';                  // คอม
}
function scaleKey()  { return 'nn_scale_'  + getScreenBucket(); }
function widthKey()  { return 'nn_width_'  + getScreenBucket(); }

// ── State ──────────────────────────────────────────
let pdfScale   = parseFloat(localStorage.getItem(scaleKey())  || localStorage.getItem('nn_scale')  || '1.4');
let pdfWidth   = parseInt( localStorage.getItem(widthKey())   || localStorage.getItem('nn_width')   || '88');
let sizeLocked    = localStorage.getItem('nn_sizelock') === '1';
let horizMode     = localStorage.getItem('nn_horiz') === '1';
let pageColor     = localStorage.getItem('nn_pagecolor') || 'cream'; // cream | white | night
let pdfContrast   = parseInt(localStorage.getItem('nn_contrast')   || '100');
let pdfBrightness = parseInt(localStorage.getItem('nn_brightness') || '100');
let pdfSharpness  = localStorage.getItem('nn_sharp') === '1';
// ── Reading Presets ───────────────────────────────
const PRESETS = {
  day:   { label:'🌤 กลางวัน', pageColor:'white', contrast:100, brightness:100, sharpness:false, warmTint: 0  },
  cream: { label:'📖 ครีม',    pageColor:'cream', contrast:108, brightness: 95, sharpness:true,  warmTint: 8  },
  dusk:  { label:'🌆 พลบค่ำ',  pageColor:'cream', contrast:120, brightness: 78, sharpness:true,  warmTint: 28 },
  night: { label:'🌙 กลางคืน', pageColor:'night', contrast: 88, brightness: 75, sharpness:false, warmTint: 40 },
};
let activePreset     = localStorage.getItem('nn_preset') || '';
let warmTint         = parseInt(localStorage.getItem('nn_warm') || '0');    // 0–100
let autoCropEnabled  = localStorage.getItem('nn_autocrop') === '1';
let autoCrop         = null; // { top, bottom, left, right } ← fractions 0–1

let activeSort = 'all';        // all | last_read | newest | az
let activeFolder = null;       // null | reading | towatch | done
let searchQuery = '';
let allNovels = [];            // cache of last loaded novels
let allProgress = {};          // novelId → progress row
let pdfDoc = null, curPage = 1, totalPages = 0, curNovelId = null;
let pageObserver = null, saveTimer = null, _restoring = false;
let _pageWrappers = [], _scrollRAF = null, _estPageH = 300;
let _basePageH = 300, _baseScale = 1.4; // accurate reference ไม่สะสม error
let barsVisible = true, hideTimer = null;
let readerStartTs = 0;         // when reader opened (for minute tracking)
let lastPageForStats = 0;      // for tracking forward page turns
let activeDrawerTab = 'read';  // read | marks | stats
let wakeLock = null;           // Screen Wake Lock sentinel
let wakeWanted = localStorage.getItem('nn_wake') === '1';
const wakeLockSupported = ('wakeLock' in navigator);

const PAGE_COLOR_FILTERS = {
  cream: 'none',
  white: 'none',
  night: 'invert(0.92) hue-rotate(180deg)',
};
const PAGE_COLOR_FILL = {
  cream: '#f0e6d3',
  white: null,
  night: null,
};

const urlCache = new Map();
const pdfCache = new Map();
const PDF_CACHE_MAX = 20;
function setPdfCache(id, pdf) {
  if (pdfCache.size >= PDF_CACHE_MAX) {
    const oldest = pdfCache.keys().next().value;
    pdfCache.delete(oldest);
  }
  pdfCache.set(id, pdf);
}

// ── Card accent color (hash ชื่อ → gradient ไม่ซ้ำกัน) ──
const CARD_PALETTES = [
  ['#ff4d8d','#f9a8c9'], ['#fdc92e','#fde47f'], ['#22d3aa','#86efcf'],
  ['#a78bfa','#d4bbff'], ['#fb7185','#fca5a5'], ['#60a5fa','#93c5fd'],
  ['#f97316','#fdba74'], ['#34d399','#6ee7b7'],
];
function getCardAccent(title) {
  let h = 0;
  for (const c of title || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CARD_PALETTES[h % CARD_PALETTES.length];
}

// ── Thumbnail cache (IndexedDB) ────────────────────
let _thumbDB = null;
async function getThumbDB() {
  if (_thumbDB) return _thumbDB;
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('nn-thumbs', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('thumbs');
    r.onsuccess = e => { _thumbDB = e.target.result; resolve(_thumbDB); };
    r.onerror = () => reject(r.error);
  });
}
async function getThumb(id) {
  try {
    const db = await getThumbDB();
    return new Promise(res => {
      const req = db.transaction('thumbs').objectStore('thumbs').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror  = () => res(null);
    });
  } catch { return null; }
}
async function saveThumb(id, dataUrl) {
  try {
    const db = await getThumbDB();
    db.transaction('thumbs','readwrite').objectStore('thumbs').put(dataUrl, id);
  } catch {}
}

// ── Cover load queue (max 2 concurrent) ───────────
const coverQ = { q: [], n: 0, max: 2 };
function queueCoverLoad(fn) {
  coverQ.q.push(fn);
  drainCoverQ();
}
function drainCoverQ() {
  while (coverQ.n < coverQ.max && coverQ.q.length) {
    coverQ.n++;
    coverQ.q.shift()().finally(() => { coverQ.n--; drainCoverQ(); });
  }
}

async function getCachedUrl(novelId, filePath) {
  const c = urlCache.get(novelId);
  if (c && Date.now() - c.ts < 50 * 60 * 1000) return c.url;
  const url = await storageSignedUrl(filePath);
  urlCache.set(novelId, { url, ts: Date.now() });
  if (c && c.url !== url) pdfCache.delete(novelId);
  return url;
}

// ============================================================================
// STREAK & STATS (localStorage)
// ============================================================================

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function daysBetween(d1, d2) {
  // returns number of full days between two YYYY-MM-DD strings
  const a = new Date(d1+'T00:00:00');
  const b = new Date(d2+'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function getStreak() {
  return {
    count:   parseInt(localStorage.getItem('nn_streak_count')   || '0'),
    longest: parseInt(localStorage.getItem('nn_streak_longest') || '0'),
    last:    localStorage.getItem('nn_streak_last') || '',
  };
}

function recordReadingDay() {
  // call whenever user reads a page; updates streak.
  const today = todayKey();
  const st = getStreak();

  // mark today as a reading day (used by 7-day strip)
  localStorage.setItem('nn_day_' + today, '1');

  if (st.last === today) return; // already counted today

  let newCount;
  if (!st.last) {
    newCount = 1;
  } else {
    const diff = daysBetween(st.last, today);
    newCount = diff === 1 ? st.count + 1 : 1;
  }
  const longest = Math.max(st.longest, newCount);
  localStorage.setItem('nn_streak_count', String(newCount));
  localStorage.setItem('nn_streak_longest', String(longest));
  localStorage.setItem('nn_streak_last', today);

  // small celebration toast if continuing
  if (newCount > 1) {
    setTimeout(() => showToast(`🔥 ${newCount} วันติด! สุดยอด!`), 600);
  }

  updateStreakUI();
}

function getTodayStats() {
  const raw = localStorage.getItem('nn_stats_' + todayKey());
  if (!raw) return { pages: 0, minutes: 0 };
  try { return JSON.parse(raw); } catch { return { pages: 0, minutes: 0 }; }
}
function setTodayStats(s) { localStorage.setItem('nn_stats_' + todayKey(), JSON.stringify(s)); }

function recordPageRead() {
  const s = getTodayStats();
  s.pages = (s.pages || 0) + 1;
  setTodayStats(s);
  recordReadingDay();
}
function recordMinutes(min) {
  if (min < 0.05) return;
  const s = getTodayStats();
  s.minutes = (s.minutes || 0) + min;
  setTodayStats(s);
}

function getTotalStats() {
  let totalPages = 0, totalMinutes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('nn_stats_')) {
      try {
        const s = JSON.parse(localStorage.getItem(k));
        totalPages += s.pages || 0;
        totalMinutes += s.minutes || 0;
      } catch {}
    }
  }
  return { totalPages, totalMinutes: Math.round(totalMinutes) };
}

// 7-day strip for streak modal
function getWeekDays() {
  const days = [];
  const labels = ['อา','จ','อ','พ','พฤ','ศ','ส'];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const k = dateKey(d);
    const read = !!localStorage.getItem('nn_day_' + k);
    days.push({ key: k, label: labels[d.getDay()], read, isToday: i === 0 });
  }
  return days;
}

function updateStreakUI() {
  const st = getStreak();
  document.getElementById('streak-count').textContent = st.count;
  document.getElementById('about-streak').textContent = st.count;
  // Greeting line variant
  const h = new Date().getHours();
  let g = 'สวัสดี';
  if (h < 12) g = 'อรุณสวัสดิ์';
  else if (h < 18) g = 'สวัสดีตอนบ่าย';
  else g = 'สวัสดีตอนเย็น';
  document.getElementById('lib-hello').innerHTML = `${g}, นักอ่าน! 👋`;
}

// ── Preset functions ──────────────────────────────
function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  activePreset = key;
  localStorage.setItem('nn_preset', key);
  pageColor     = p.pageColor;
  pdfContrast   = p.contrast;
  pdfBrightness = p.brightness;
  pdfSharpness  = p.sharpness;
  localStorage.setItem('nn_pagecolor',  p.pageColor);
  localStorage.setItem('nn_contrast',   String(p.contrast));
  localStorage.setItem('nn_brightness', String(p.brightness));
  localStorage.setItem('nn_sharp',      p.sharpness ? '1' : '0');
  setWarmTint(p.warmTint ?? 0);
  updatePresetUI();
  syncAdvancedSliders();
  if (pdfDoc) rerenderVisiblePages();
  showToast(`✅ ${p.label}`);
}
function updatePresetUI() {
  document.querySelectorAll('.preset-card').forEach(el =>
    el.classList.toggle('active', el.dataset.preset === activePreset));
}
function syncAdvancedSliders() {
  const cs = document.getElementById('contrast-slider');
  const cd = document.getElementById('contrast-display');
  const bs = document.getElementById('bright-slider');
  const bd = document.getElementById('bright-display');
  const st = document.getElementById('sharp-toggle');
  if (cs) cs.value = pdfContrast;
  if (cd) cd.textContent = pdfContrast + '%';
  if (bs) bs.value = pdfBrightness;
  if (bd) bd.textContent = pdfBrightness + '%';
  if (st) st.checked = pdfSharpness;
  applyPageColorUI();
}
function toggleAdvanced() {
  const panel = document.getElementById('advanced-panel');
  const arrow = document.getElementById('adv-arrow');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▾' : '▴';
}

// ── Warm Tint ─────────────────────────────────────
function setWarmTint(val) {
  warmTint = parseInt(val);
  localStorage.setItem('nn_warm', warmTint);
  const overlay = document.getElementById('warm-overlay');
  if (overlay) overlay.style.background = warmTint > 0
    ? `rgba(255,120,0,${(warmTint * 0.0028).toFixed(3)})` : 'transparent';
  const wd = document.getElementById('warm-display');
  if (wd) wd.textContent = warmTint + '%';
  const ws = document.getElementById('warm-slider');
  if (ws) ws.value = warmTint;
}

// ── Auto-crop ─────────────────────────────────────
async function detectAutoCrop() {
  if (!pdfDoc) return null;
  const SCALE = 0.25, THRESH = 238, PAD = 0.018;
  const pages = [1];
  if (pdfDoc.numPages >= 5)  pages.push(5);
  if (pdfDoc.numPages >= 12) pages.push(12);
  let mT = 1, mB = 1, mL = 1, mR = 1;
  for (const pn of pages) {
    try {
      const pg = await pdfDoc.getPage(pn);
      const vp = pg.getViewport({ scale: SCALE });
      const W = Math.round(vp.width), H = Math.round(vp.height);
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
      await pg.render({ canvasContext: cx, viewport: vp }).promise;
      const d = cx.getImageData(0, 0, W, H).data;
      const light = (i) => (d[i] + d[i+1] + d[i+2]) / 3 > THRESH;
      const rowOk = (y) => { for (let x = 0; x < W; x++) { if (!light((y*W+x)*4)) return false; } return true; };
      const colOk = (x) => { for (let y = 0; y < H; y++) { if (!light((y*W+x)*4)) return false; } return true; };
      let t = 0; while (t < H*.45 && rowOk(t)) t++;
      let b = H-1; while (b > H*.55 && rowOk(b)) b--;
      let l = 0; while (l < W*.45 && colOk(l)) l++;
      let r = W-1; while (r > W*.55 && colOk(r)) r--;
      mT = Math.min(mT, t/H); mB = Math.min(mB, 1-b/H);
      mL = Math.min(mL, l/W); mR = Math.min(mR, 1-r/W);
    } catch(_) {}
  }
  mT = Math.max(0, mT-PAD); mB = Math.max(0, mB-PAD);
  mL = Math.max(0, mL-PAD); mR = Math.max(0, mR-PAD);
  const total = mT + mB + mL + mR;
  return total > 0.04 ? { top:mT, bottom:mB, left:mL, right:mR } : null;
}

async function toggleAutoCrop() {
  autoCropEnabled = document.getElementById('autocrop-toggle').checked;
  localStorage.setItem('nn_autocrop', autoCropEnabled ? '1' : '0');
  if (!pdfDoc) return;
  if (autoCropEnabled) {
    if (!pdfDoc._crop) {
      showToast('✂️ กำลังวิเคราะห์หน้า...');
      pdfDoc._crop = await detectAutoCrop();
    }
    autoCrop = pdfDoc._crop;
    if (autoCrop) {
      // auto-fit ให้เนื้อหาเต็มจอหลังตัด margin
      const page = await pdfDoc.getPage(curPage || 1);
      const base = page.getViewport({ scale: 1 });
      const areaW = document.getElementById('pdf-area').clientWidth;
      const cropW = (1 - autoCrop.left - autoCrop.right);
      pdfScale = parseFloat(Math.max(0.5, Math.min(3.0, areaW / (base.width * cropW))).toFixed(2));
      pdfWidth = 100;
      localStorage.setItem(scaleKey(), pdfScale);
      localStorage.setItem(widthKey(), pdfWidth);
      updateScaleDisplay();
      await renderAllPages(curPage || 1);
      showToast('✂️ ตัด margin แล้ว — ตัวหนังสือเต็มจอ ✅');
    } else {
      autoCropEnabled = false;
      document.getElementById('autocrop-toggle').checked = false;
      localStorage.removeItem('nn_autocrop');
      showToast('ℹ️ ไม่พบ margin ที่ตัดได้');
    }
  } else {
    autoCrop = null;
    await renderAllPages(curPage || 1);
    showToast('✂️ ปิดตัด margin แล้ว');
  }
}

function updateStatsUI() {
  const s = getTodayStats();
  document.getElementById('stat-pages').textContent = s.pages || 0;
  document.getElementById('stat-minutes').textContent = (Math.round(s.minutes) || 0) + 'น';
  // books done this month (from allNovels + progress)
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let done = 0;
  for (const n of allNovels) {
    const p = allProgress[n.id];
    if (n.total_pages && p && p.current_page >= n.total_pages && p.updated_at && p.updated_at.startsWith(monthPrefix)) {
      done++;
    }
  }
  document.getElementById('stat-done').textContent = done;
}

function showStreakInfo() {
  const st = getStreak();
  const totals = getTotalStats();
  document.getElementById('sm-streak').textContent = st.count;
  document.getElementById('sm-longest').textContent = st.longest;
  document.getElementById('sm-pages-total').textContent = totals.totalPages;
  document.getElementById('sm-min-total').textContent = totals.totalMinutes;
  // week strip
  const strip = document.getElementById('week-strip');
  strip.innerHTML = getWeekDays().map(d => `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="font-size:10px;color:var(--cp-ink-soft);font-weight:700">${d.label}</div>
      <div style="width:32px;height:32px;border-radius:10px;border:2px solid var(--cp-border);
        background:${d.read ? 'var(--cp-pink)' : '#fff'};
        color:${d.read ? '#fff' : 'var(--cp-ink-mute)'};
        display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;
        ${d.isToday ? 'box-shadow:2px 2px 0 var(--cp-yellow);' : ''}
      ">${d.read ? '🔥' : '·'}</div>
    </div>
  `).join('');
  document.getElementById('streak-modal').classList.add('open');
}
function closeStreakModal() { document.getElementById('streak-modal').classList.remove('open'); }

// ============================================================================
// LIBRARY
// ============================================================================

function setSort(s) {
  activeSort = s;
  document.querySelectorAll('.tag-pill').forEach(el => el.classList.toggle('active', el.dataset.sort === s));
  renderGrid();
}
function setFolder(f) {
  activeFolder = activeFolder === f ? null : f;
  document.querySelectorAll('.folder-chip').forEach(el => el.classList.toggle('active', el.dataset.filter === activeFolder));
  renderGrid();
}
function onSearchChange() {
  searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
  renderGrid();
}

async function loadNovels() {
  const grid = document.getElementById('novel-grid');
  try {
    const [novelsRaw, progsRaw] = await Promise.all([
      dbGet('novels', 'select=*&order=created_at.desc'),
      dbGet('reading_progress',
        `select=novel_id,current_page,total_pages,updated_at&device_id=eq.${deviceId}`
      ).catch(() => [])
    ]);
    let novels = novelsRaw || [];
    let progMap = {};
    (progsRaw || []).forEach(p => progMap[p.novel_id] = p);
    allNovels = novels;
    allProgress = progMap;

    try { localStorage.setItem('nn_library_cache', JSON.stringify({ novels, progMap })); } catch {}

    updateFolderCounts();
    updateContinueReading();
    updateStatsUI();
    renderGrid();
  } catch(err) {
    console.error(err);
    try {
      const raw = localStorage.getItem('nn_library_cache');
      if (raw) {
        const c = JSON.parse(raw);
        allNovels = c.novels; allProgress = c.progMap;
        updateFolderCounts(); updateContinueReading(); updateStatsUI(); renderGrid();
        showToast('📡 ออฟไลน์ — แสดงข้อมูลสำรอง');
        return;
      }
    } catch {}
    const isOffline = !navigator.onLine;
    grid.innerHTML = `<div class="state-box"><div class="ico">${isOffline ? '📡' : '⚠️'}</div><h2>${isOffline ? 'ไม่มีอินเทอร์เน็ต' : 'เชื่อมต่อ Supabase ไม่ได้'}</h2><p>${isOffline ? 'เชื่อมต่อใหม่แล้วรีเฟรช' : err.message}</p></div>`;
  }
}

function categoryOf(novel) {
  const p = allProgress[novel.id];
  const cur = p?.current_page || 0;
  const total = novel.total_pages || 0;
  if (total && cur >= total) return 'done';
  if (cur > 0) return 'reading';
  return 'towatch';
}

function updateFolderCounts() {
  const c = { reading: 0, towatch: 0, done: 0 };
  for (const n of allNovels) c[categoryOf(n)]++;
  document.getElementById('fld-reading').textContent = c.reading + ' เล่ม';
  document.getElementById('fld-towatch').textContent = c.towatch + ' เล่ม';
  document.getElementById('fld-done').textContent    = c.done + ' เล่ม';
}

function updateContinueReading() {
  // find novel with most-recent reading_progress.updated_at, where current_page > 0 and not done
  let best = null;
  for (const n of allNovels) {
    const p = allProgress[n.id];
    if (!p || !p.updated_at || !p.current_page) continue;
    if (n.total_pages && p.current_page >= n.total_pages) continue; // skip done
    if (!best || p.updated_at > allProgress[best.id].updated_at) best = n;
  }
  const wrap = document.getElementById('continue-wrap');
  if (!best) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const p = allProgress[best.id];
  const pct = Math.round((p.current_page / (best.total_pages || 1)) * 100);
  document.getElementById('continue-title').textContent = best.title;
  document.getElementById('continue-progress').textContent =
    `หน้า ${p.current_page} / ${best.total_pages || '?'} · ${pct}%`;
  document.getElementById('continue-pct').textContent = pct + '%';
  document.getElementById('continue-meta').textContent = friendlyTimeSince(p.updated_at);

  // load cover
  const coverEl = document.getElementById('continue-cover');
  queueCoverLoad(() => loadCoverInto(best, coverEl, true));
  // store id for click
  document.getElementById('continue-card').dataset.novelId = best.id;
}

function friendlyTimeSince(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'ตอนนี้';
  if (diff < 3600) return Math.round(diff/60) + ' นาทีก่อน';
  if (diff < 86400) return Math.round(diff/3600) + ' ชั่วโมงก่อน';
  if (diff < 86400*7) return Math.round(diff/86400) + ' วันก่อน';
  return Math.round(diff/86400/7) + ' สัปดาห์ก่อน';
}

function openContinueReader() {
  const id = document.getElementById('continue-card').dataset.novelId;
  const n = allNovels.find(x => x.id === id);
  if (n) openReader(n);
}

function applyFilters() {
  let list = allNovels.slice();
  // folder filter
  if (activeFolder) list = list.filter(n => categoryOf(n) === activeFolder);
  // search filter
  if (searchQuery) list = list.filter(n => (n.title || '').toLowerCase().includes(searchQuery));
  // sort
  if (activeSort === 'az') {
    list.sort((a,b) => (a.title||'').localeCompare(b.title||'', 'th'));
  } else if (activeSort === 'last_read') {
    list.sort((a,b) => (allProgress[b.id]?.updated_at || '0').localeCompare(allProgress[a.id]?.updated_at || '0'));
  } else if (activeSort === 'newest') {
    list.sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  // 'all' = use default (created_at desc from server)
  return list;
}

function renderGrid() {
  const grid = document.getElementById('novel-grid');
  const list = applyFilters();
  document.getElementById('shelf-count').textContent = list.length + ' เล่ม';

  if (list.length === 0) {
    if (allNovels.length === 0) {
      grid.innerHTML = `<div class="state-box">
        <div class="ico">📚</div><h2>ยังไม่มีนิยาย</h2>
        <p>กด ＋ ที่ช่องค้นหา เพื่อเพิ่มเล่มแรก!</p></div>`;
    } else {
      grid.innerHTML = `<div class="state-box">
        <div class="ico">🔍</div><h2>ไม่พบนิยายที่ตรงกัน</h2>
        <p>ลองเปลี่ยนคำค้นหรือยกเลิกตัวกรอง</p></div>`;
    }
    return;
  }
  grid.innerHTML = '';
  list.forEach((novel, idx) => {
    const card = buildCard(novel, allProgress[novel.id] || null, idx);
    grid.appendChild(card);
    queueCoverLoad(() => loadCoverInto(novel, card.querySelector('.novel-cover'), false));
  });
}

function buildCard(novel, progress, idx) {
  const pct = (progress?.current_page && novel.total_pages)
    ? Math.round(progress.current_page / novel.total_pages * 100) : 0;
  const done = novel.total_pages && progress?.current_page >= novel.total_pages;
  const isNew = !progress?.current_page;
  const isPinned = !!localStorage.getItem('nn_pin_' + novel.id);
  const [c1, c2] = getCardAccent(novel.title);

  const tilt = idx % 2 === 0 ? 'tilt-l' : 'tilt-r';

  const card = document.createElement('div');
  card.className = 'novel-card ' + tilt;
  card.onclick = () => openReader(novel);
  card.innerHTML = `
    <div class="novel-cover" style="background:linear-gradient(160deg,${c1} 0%,${c2} 100%)">
      <span class="ph-emoji">📖</span>
      ${done ? '<div class="badge-done">✓ จบแล้ว</div>' : ''}
      ${isNew && !done ? '<div class="badge-new">✨ ใหม่</div>' : ''}
      ${pct > 0 && !done ? `
        <div class="cover-progress">
          <span class="pct-txt">${pct}%</span>
          <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
        </div>` : ''}
    </div>
    <div class="card-actions">
      <button class="card-btn card-btn-edit" title="แก้ชื่อ" onclick="renameNovel(event,'${novel.id}','${escAttr(novel.title)}')">✏️</button>
      <button class="card-btn card-btn-del"  title="ลบ"     onclick="confirmDelete(event,'${novel.id}','${escAttr(novel.file_url)}','${escAttr(novel.title)}')">🗑️</button>
    </div>
    <div class="novel-title">${escHtml(novel.title)}</div>
    <div class="novel-sub">${novel.total_pages ? novel.total_pages+' หน้า' : '—'}${pct>0 ? (novel.total_pages?' · ':'')+pct+'%':''}</div>`;
  return card;
}

async function loadCoverInto(novel, coverEl, isContinue) {
  if (!novel.file_url || !coverEl) return;
  try {
    // Fast path: thumbnail ที่ cache ไว้ใน IndexedDB (instant)
    const cached = await getThumb(novel.id);
    if (cached) {
      const img = new Image();
      img.src = cached;
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:10px';
      const keep = Array.from(coverEl.children).filter(el => !el.matches('.ph-emoji,canvas,img'));
      coverEl.innerHTML = ''; coverEl.appendChild(img);
      keep.forEach(el => coverEl.appendChild(el));
      return;
    }
    // Slow path: render จาก PDF แล้ว cache ไว้
    const url = await getCachedUrl(novel.id, novel.file_url);
    let pdf = pdfCache.get(novel.id);
    if (!pdf) {
      pdf = await pdfjsLib.getDocument(url).promise;
      setPdfCache(novel.id, pdf);
    }
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 0.4 }); // ลด scale → render เร็วขึ้น
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    saveThumb(novel.id, canvas.toDataURL('image/jpeg', 0.72)); // cache ไว้ครั้งต่อไป
    const keep = Array.from(coverEl.children).filter(el => !el.matches('.ph-emoji,canvas'));
    coverEl.innerHTML = ''; coverEl.appendChild(canvas);
    keep.forEach(el => coverEl.appendChild(el));
  } catch(_) {}
}

// ── Toast ──────────────────────────────────────────
let toastT;
function showToast(msg) {
  const el = document.getElementById('toast');
  const readerOpen = document.getElementById('reader-page').classList.contains('open');
  el.style.bottom = readerOpen ? '80px' : '100px';
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Rename ─────────────────────────────────────────
let _renameId = null;
function renameNovel(e, id, oldTitle) {
  e.stopPropagation();
  _renameId = id;
  const inp = document.getElementById('rename-input');
  inp.value = oldTitle;
  document.getElementById('rename-modal').classList.add('open');
  setTimeout(() => { inp.focus(); inp.select(); }, 80);
}
function closeRename() { document.getElementById('rename-modal').classList.remove('open'); }
async function doRename() {
  const newTitle = document.getElementById('rename-input').value.trim();
  if (!newTitle) return;
  closeRename();
  try {
    await dbPatch('novels', `id=eq.${_renameId}`, { title: newTitle });
    showToast('เปลี่ยนชื่อแล้ว ✅'); loadNovels();
  } catch { showToast('เปลี่ยนชื่อไม่สำเร็จ'); }
}

// ── Delete ─────────────────────────────────────────
let _delId, _delFile;
function confirmDelete(e, id, fileUrl, title) {
  e.stopPropagation();
  _delId = id; _delFile = fileUrl;
  document.getElementById('confirm-msg').textContent = `ต้องการลบ "${title}" ออกจากชั้นหนังสือ? ไฟล์ PDF จะถูกลบถาวร`;
  document.getElementById('confirm-modal').classList.add('open');
  document.getElementById('confirm-ok').onclick = doDelete;
}
function closeConfirm() { document.getElementById('confirm-modal').classList.remove('open'); }
async function doDelete() {
  closeConfirm();
  try {
    await storageDelete(_delFile);
    await dbDelete('novels', `id=eq.${_delId}`);
    showToast('ลบแล้ว ✅'); loadNovels();
  } catch(err) { showToast('ลบไม่สำเร็จ: ' + err.message); }
}

// ============================================================================
// READER
// ============================================================================

async function openReader(novel) {
  curNovelId = novel.id;
  document.getElementById('reader-title').textContent = novel.title;
  document.getElementById('reader-page').classList.add('open');
  document.getElementById('library-page').style.display = 'none';
  document.getElementById('bottom-nav').style.display = 'none';
  document.body.classList.add('reader-open');
  document.getElementById('horiz-toggle').checked = horizMode;
  document.getElementById('lock-toggle').checked = sizeLocked;
  document.getElementById('wake-toggle').checked = wakeWanted;
  document.getElementById('wake-row').style.display = wakeLockSupported ? '' : 'none';
  applyPageColorUI();
  applySizeLockUI();
  setWarmTint(warmTint);
  document.getElementById('autocrop-toggle').checked = autoCropEnabled;
  setBarsVisible(true);
  scheduleAutoHide();
  readerStartTs = Date.now();
  lastPageForStats = 0;
  if (wakeWanted) acquireWakeLock();
  // Disable browser native pinch zoom — app handles pinch directly
  const _vm = document.querySelector('meta[name="viewport"]');
  if (_vm) _vm.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
  initPinchHandler();

  history.pushState({ nnReader: true }, '');

  const area = document.getElementById('pdf-area');
  const safeTitle = novel.title.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  area.innerHTML = `<div class="load-screen" id="load-screen">
    <div class="load-icon">📖</div>
    <div class="load-title">${safeTitle}</div>
    <div class="load-bar-track"><div class="load-bar-fill" id="load-bar"></div></div>
    <div class="load-pct" id="load-pct">กำลังโหลด...</div>
  </div>`;
  try {
    pdfDoc = pdfCache.get(novel.id) || null;
    if (!pdfDoc) {
      const offlineData = await getOfflinePdfData(novel.id);
      if (offlineData) {
        pdfDoc = await pdfjsLib.getDocument({ data: offlineData }).promise;
      } else {
        const url = await getCachedUrl(novel.id, novel.file_url);
        pdfDoc = await pdfjsLib.getDocument({
          url,
          onProgress({ loaded, total }) {
            const bar = document.getElementById('load-bar');
            const pct = document.getElementById('load-pct');
            if (!bar) return;
            if (total > 0) {
              const p = Math.min(97, Math.round(loaded / total * 100));
              bar.style.width = p + '%';
              if (pct) pct.textContent = p + '%';
            }
          }
        }).promise;
      }
      setPdfCache(novel.id, pdfDoc);
    }
    totalPages = pdfDoc.numPages;
    const prog = allProgress[novel.id] || null;
    curPage = prog?.current_page || 1;
    lastPageForStats = curPage;
    if (!pdfDoc._ps) { pdfDoc._ps = true; dbPatch('novels',`id=eq.${curNovelId}`,{total_pages:totalPages}).catch(()=>{}); }
    // ตรวจ auto-crop ครั้งแรกต่อ PDF (cache ไว้ใน pdfDoc._crop)
    if (autoCropEnabled) {
      if (!pdfDoc._crop) pdfDoc._crop = await detectAutoCrop();
      autoCrop = pdfDoc._crop;
    } else {
      autoCrop = null;
    }
    // Auto-fit ครั้งแรกถ้าหน้าจอขนาดนี้ยังไม่เคยตั้งค่า
    if (!localStorage.getItem(scaleKey())) await fitToScreen();
    await renderAllPages(curPage);
  } catch(err) {
    console.error(err);
    const isOffline = !navigator.onLine;
    document.getElementById('pdf-area').innerHTML = `<div class="page-placeholder">${isOffline ? '📡 ไม่มีเน็ต — กด 📥 บนการ์ดเพื่อบันทึกออฟไลน์' : '⚠️ โหลดไม่ได้ กรุณาลองใหม่'}</div>`;
    showToast(isOffline ? '📡 ไม่มีเน็ต' : 'โหลด PDF ไม่ได้');
  }
}

async function renderAllPages(scrollTo = 1) {
  if (!pdfDoc) return;
  const area = document.getElementById('pdf-area');
  if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
  area.innerHTML = '';
  area.style.overflowX = (pdfWidth > 100 && !horizMode) ? 'auto' : '';
  area.classList.toggle('horiz', horizMode);

  // ประมาณความสูงหน้าจาก page 1 และเก็บเป็น base reference
  _estPageH = 300;
  try {
    const _pg1 = await pdfDoc.getPage(1);
    _estPageH = Math.round(_pg1.getViewport({ scale: pdfScale }).height / (window.devicePixelRatio || 1));
    _basePageH = _estPageH;
    _baseScale = pdfScale;
  } catch(_) {}

  const content = document.createElement('div');
  content.id = 'pdf-content';
  _pageWrappers = [];

  // สร้าง spinner HTML เฉพาะหน้าที่อยู่ใกล้ scrollTo — หน้าไกลใช้แค่ min-height (เร็วกว่า innerHTML มาก)
  const NEAR_WIN  = 12;
  const nearStart = Math.max(1, scrollTo - 3);
  const nearEnd   = Math.min(totalPages, scrollTo + NEAR_WIN);

  const frag = document.createDocumentFragment();
  for (let i = 1; i <= totalPages; i++) {
    const w = document.createElement('div');
    w.className = 'page-wrapper'; w.dataset.page = i;
    if (i >= nearStart && i <= nearEnd) {
      w.innerHTML = `<div class="page-placeholder"><div class="spinner"></div><span>หน้า ${i}</span></div>`;
    } else {
      w.style.minHeight = _estPageH + 'px'; // lightweight spacer ไม่ต้อง parse HTML
    }
    frag.appendChild(w);
    _pageWrappers.push(w);
  }
  content.appendChild(frag); // DOM mutation ครั้งเดียว
  area.appendChild(content);

  pageObserver = new IntersectionObserver(async (entries) => {
    for (const en of entries) {
      if (en.isIntersecting && !en.target._rendered) {
        en.target._rendered = true;
        if (!en.target.querySelector('.spinner')) {
          // lightweight placeholder → ใส่ spinner ก่อน render
          en.target.innerHTML = `<div class="page-placeholder"><div class="spinner"></div><span>หน้า ${en.target.dataset.page}</span></div>`;
        }
        await renderPageInto(parseInt(en.target.dataset.page), en.target);
      }
    }
  }, { root: area, threshold: 0.05 });
  _pageWrappers.forEach(w => pageObserver.observe(w));

  setTimeout(() => {
    const t = area.querySelector(`[data-page="${scrollTo}"]`);
    if (t) {
      _restoring = true;
      t.scrollIntoView({ behavior:'auto', block:'start' });
      curPage = scrollTo;
      document.getElementById('page-counter').textContent = `${scrollTo} / ${totalPages}`;
      setTimeout(() => { _restoring = false; }, 800);
    }
  }, 80);

  area.onscroll = () => {
    if (_restoring) return;
    if (_scrollRAF) cancelAnimationFrame(_scrollRAF);
    _scrollRAF = requestAnimationFrame(() => {
      _scrollRAF = null;
      const ar = area.getBoundingClientRect();
      const mid = horizMode ? ar.left + ar.width * .35 : ar.top + ar.height * .35;
      // วนจาก curPage±4 ก่อน แล้ว fallback ทั้งหมด — ไม่สร้าง array ใหม่
      const len      = _pageWrappers.length;
      const startIdx = Math.max(0, curPage - 4);
      const endIdx   = Math.min(len - 1, curPage + 2);
      let found = false;
      for (let pass = 0; pass < 2 && !found; pass++) {
        const lo = pass === 0 ? startIdx : 0;
        const hi = pass === 0 ? endIdx   : len - 1;
        for (let i = lo; i <= hi && !found; i++) {
          if (pass === 1 && i >= startIdx && i <= endIdx) continue;
          const w = _pageWrappers[i];
          const r = w.getBoundingClientRect();
          const s = horizMode ? r.left : r.top;
          const x = horizMode ? r.right : r.bottom;
          if (s <= mid && x >= mid) {
            found = true;
            const p = parseInt(w.dataset.page);
            if (p !== curPage) {
              if (p > lastPageForStats) {
                const diff = p - lastPageForStats;
                for (let k = 0; k < diff; k++) recordPageRead();
                lastPageForStats = p;
              } else if (p < lastPageForStats) {
                lastPageForStats = p;
              }
              curPage = p;
              document.getElementById('page-counter').textContent = `${p} / ${totalPages}`;
              document.getElementById('bm-cur-page').textContent = p;
              updateScrubber(p);
              clearTimeout(saveTimer);
              saveTimer = setTimeout(() => saveProgress(curNovelId, p, totalPages), 1500);
              unloadDistantPages(p);
            }
          }
        }
      }
    });
  };
  document.getElementById('page-counter').textContent = `${scrollTo} / ${totalPages}`;
  document.getElementById('bm-cur-page').textContent = scrollTo;
  updateScrubber(scrollTo);
  initScrubber();
  renderBookmarkList();
}

async function renderPageInto(pageNum, wrapper) {
  // Capture generation so stale renders (started before a pinch-zoom) don't
  // overwrite the fresh canvas rendered at the new pdfScale.
  const myGen = (wrapper._renderGen = (wrapper._renderGen || 0) + 1);
  try {
    const page = await pdfDoc.getPage(pageNum);
    if (wrapper._renderGen !== myGen) return; // superseded — discard
    const dpr  = window.devicePixelRatio || 1;

    // ── Auto-crop: คำนวณ offset + ขนาด canvas ──
    const vp0 = page.getViewport({ scale: pdfScale * dpr });
    let vp, cW, cH;
    if (autoCropEnabled && autoCrop) {
      const { top:cT, bottom:cB, left:cL, right:cR } = autoCrop;
      const oX = Math.round(cL * vp0.width);
      const oY = Math.round(cT * vp0.height);
      cW = Math.max(1, Math.round(vp0.width  - oX - Math.round(cR * vp0.width)));
      cH = Math.max(1, Math.round(vp0.height - oY - Math.round(cB * vp0.height)));
      vp = page.getViewport({ scale: pdfScale * dpr, offsetX: -oX, offsetY: -oY });
    } else {
      vp = vp0; cW = Math.round(vp0.width); cH = Math.round(vp0.height);
    }

    const canvas = document.createElement('canvas');
    canvas.width  = cW; canvas.height = cH;
    canvas.style.width  = (cW / dpr) + 'px';
    canvas.style.height = (cH / dpr) + 'px';
    canvas.style.maxWidth = pdfWidth + '%';
    canvas.style.filter = getPdfFilter();
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cW, cH);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    // Apply cream tint
    const fill = PAGE_COLOR_FILL[pageColor];
    if (fill) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, cW, cH);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Save original pixels (before text enhancement) for fast re-apply
    wrapper._origData = ctx.getImageData(0, 0, cW, cH);
    wrapper._canvas   = canvas;
    // Apply enhancement on top
    applyEnhancementFromOrig(wrapper);
    // append ก่อน ลบทีหลัง → ไม่มี blank frame ระหว่างสลับ
    wrapper.appendChild(canvas);
    while (wrapper.firstChild !== canvas) wrapper.removeChild(wrapper.firstChild);
    if (pageNum === 1) {
      const px = wrapper._origData.data;
      document.getElementById('pdf-area').style.background = `rgb(${px[0]},${px[1]},${px[2]})`;
    }
  } catch { wrapper.innerHTML = `<div class="page-placeholder">⚠️ หน้า ${pageNum} โหลดไม่ได้</div>`; }
}

function unloadDistantPages(current) {
  const WIN     = horizMode ? 3 : 6;
  const ORIG_WIN = 2; // เก็บ ImageData เฉพาะ ±2 หน้า
  _pageWrappers.forEach(w => {
    const num  = parseInt(w.dataset.page);
    const dist = Math.abs(num - current);
    if (dist > WIN && w._rendered) {
      const savedH = w._canvas ? w._canvas.offsetHeight : 0;
      w._rendered = false;
      w._origData = null;
      w._canvas   = null;
      w.innerHTML = `<div class="page-placeholder" style="min-height:${savedH || 200}px"></div>`;
      if (pageObserver) { pageObserver.unobserve(w); pageObserver.observe(w); }
    } else if (dist > ORIG_WIN && w._origData) {
      w._origData = null; // ปล่อย pixel buffer แต่ canvas ยังแสดงอยู่
    }
  });
}

// ── Offline PDF Cache ──────────────────────────────
const PDF_CACHE_NAME = 'nn-pdfs-v1';

async function getOfflinePdfData(novelId) {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(PDF_CACHE_NAME);
    const res = await cache.match('pdf-' + novelId);
    return res ? res.arrayBuffer() : null;
  } catch { return null; }
}

async function pinForOffline(e, novelId, filePath, title) {
  e.stopPropagation();
  if (!('caches' in window)) { showToast('เบราว์เซอร์นี้ไม่รองรับ'); return; }
  const isPinned = !!localStorage.getItem('nn_pin_' + novelId);
  if (isPinned) {
    try { const c = await caches.open(PDF_CACHE_NAME); await c.delete('pdf-' + novelId); } catch {}
    localStorage.removeItem('nn_pin_' + novelId);
    showToast('🗑️ ลบออฟไลน์แล้ว'); renderGrid();
    return;
  }
  showToast('📥 กำลังดาวน์โหลด...');
  try {
    const url = await getCachedUrl(novelId, filePath);
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed');
    const cache = await caches.open(PDF_CACHE_NAME);
    await cache.put('pdf-' + novelId, res);
    localStorage.setItem('nn_pin_' + novelId, '1');
    showToast(`✅ "${title}" บันทึกออฟไลน์แล้ว`); renderGrid();
  } catch { showToast('❌ ดาวน์โหลดไม่สำเร็จ'); }
}

// ── Backup / Restore ───────────────────────────────
function exportBackup() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('nn_')) data[k] = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `novelnest-backup-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('💾 ดาวน์โหลด backup แล้ว');
}
function importBackup() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = async ev => {
    try {
      const text = await ev.target.files[0].text();
      const data = JSON.parse(text);
      let count = 0;
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith('nn_')) { localStorage.setItem(k, v); count++; }
      }
      showToast(`✅ นำเข้า ${count} รายการ — กำลังรีโหลด`);
      setTimeout(() => location.reload(), 1600);
    } catch { showToast('❌ ไฟล์ไม่ถูกต้อง'); }
  };
  inp.click();
}

async function getProgress(novelId) {
  try {
    const rows = await dbGet('reading_progress', `select=*&novel_id=eq.${novelId}&device_id=eq.${deviceId}&limit=1`);
    return rows?.[0] || null;
  } catch { return null; }
}
async function saveProgress(novelId, page, total, keepalive = false) {
  try {
    const h = { ...H, 'Prefer': 'resolution=merge-duplicates' };
    const body = JSON.stringify({ novel_id:novelId, device_id:deviceId, current_page:page, total_pages:total, updated_at:new Date().toISOString() });
    const r = await fetch(
      `${SB_URL}/rest/v1/reading_progress?on_conflict=novel_id,device_id`,
      { method:'POST', headers:h, body, keepalive }
    );
    if (!r.ok) console.error('saveProgress:', await r.text());
  } catch(e) { console.warn('saveProgress:', e); }
}

function closeReader() {
  if (!document.getElementById('reader-page').classList.contains('open')) return;
  if (history.state?.nnReader) history.replaceState(null, '');
  // tally time
  if (readerStartTs) {
    const min = (Date.now() - readerStartTs) / 60000;
    recordMinutes(min);
    readerStartTs = 0;
  }
  releaseWakeLock();
  document.getElementById('reader-page').classList.remove('open');
  document.getElementById('library-page').style.display = '';
  document.getElementById('bottom-nav').style.display = '';
  document.body.classList.remove('reader-open');
  activeDrawerTab = 'stats';
  if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
  if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; }
  _pageWrappers = [];
  _pinch.active = false;
  const _sw = document.getElementById('scrubber-wrap');
  if (_sw) _sw._scrubBound = false;
  clearTimeout(hideTimer);
  setBarsVisible(true);
  const _a = document.getElementById('pdf-area');
  if (_a) {
    _a.classList.remove('zoom-locked'); _a.style.overflowX = '';
    if (_a._pinchBound) {
      _a.removeEventListener('touchstart',  _onPinchStart);
      _a.removeEventListener('touchmove',   _onPinchMove);
      _a.removeEventListener('touchend',    _onPinchEnd);
      _a.removeEventListener('touchcancel', _onPinchEnd);
      _a._pinchBound = false;
    }
  }
  document.removeEventListener('gesturestart',  _blockGesture, { passive: false });
  document.removeEventListener('gesturechange', _blockGesture, { passive: false });
  // Restore browser zoom
  const _vm = document.querySelector('meta[name="viewport"]');
  if (_vm) _vm.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
  if (curNovelId && curPage) saveProgress(curNovelId, curPage, totalPages);
  pdfDoc = null; closeSettings(); loadNovels();
}

// ── Page color (Readera style) ─────────────────────
function setPageColor(pc) {
  pageColor = pc;
  localStorage.setItem('nn_pagecolor', pc);
  activePreset = ''; localStorage.removeItem('nn_preset'); updatePresetUI();
  applyPageColorUI();
  if (pdfDoc) rerenderVisiblePages();
}
function applyPageColorUI() {
  document.querySelectorAll('.quick-pc-pill').forEach(el =>
    el.classList.toggle('active', el.dataset.pc === pageColor));
}
function rerenderVisiblePages() {
  _pageWrappers.forEach(w => {
    if (!w._rendered) return;
    w._rendered = false;
    renderPageInto(parseInt(w.dataset.page), w);
  });
}
function getPdfFilter() {
  // Only night mode uses CSS filter — contrast/brightness/sharpness handled by pixel processing
  const base = PAGE_COLOR_FILTERS[pageColor];
  return (base && base !== 'none') ? base : 'none';
}

// ── Pixel-level text enhancement (dark pixels only) ─
// Reads from wrapper._origData so no PDF re-render needed
function applyEnhancementFromOrig(wrapper) {
  if (!wrapper._canvas || !wrapper._origData) return;
  const orig = wrapper._origData;
  const ctx  = wrapper._canvas.getContext('2d');
  if (pdfContrast === 100 && pdfBrightness === 100 && !pdfSharpness) {
    ctx.putImageData(orig, 0, 0); return;
  }
  const copy = new ImageData(new Uint8ClampedArray(orig.data), orig.width, orig.height);
  const d = copy.data;
  const cFactor = pdfContrast / 100;
  const bFactor = pdfBrightness / 100;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 299 + d[i+1] * 587 + d[i+2] * 114) / 1000;
    if (lum >= 240) continue;
    let r = d[i], g = d[i+1], b = d[i+2];
    if (pdfContrast !== 100) {
      r = Math.max(0, Math.min(255, ((r/255 - 0.5) * cFactor + 0.5) * 255));
      g = Math.max(0, Math.min(255, ((g/255 - 0.5) * cFactor + 0.5) * 255));
      b = Math.max(0, Math.min(255, ((b/255 - 0.5) * cFactor + 0.5) * 255));
    }
    if (pdfBrightness !== 100) {
      r = Math.max(0, Math.min(255, r * bFactor));
      g = Math.max(0, Math.min(255, g * bFactor));
      b = Math.max(0, Math.min(255, b * bFactor));
    }
    if (pdfSharpness && lum < 160) {
      r = Math.max(0, r * 0.82);
      g = Math.max(0, g * 0.82);
      b = Math.max(0, b * 0.82);
    }
    d[i] = r; d[i+1] = g; d[i+2] = b;
  }
  ctx.putImageData(copy, 0, 0);
}

function applyEnhancementToAll() {
  _pageWrappers.forEach(w => {
    if (!w._rendered) return;
    if (w._canvas && w._origData) {
      applyEnhancementFromOrig(w); // fast path: ใช้ pixel cache
    } else {
      renderPageInto(parseInt(w.dataset.page), w); // slow path: re-render จาก PDF
    }
  });
}

let enhanceTimer = null;
function scheduleEnhancement() {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(applyEnhancementToAll, 30);
}

// ── Contrast / Brightness / Sharpness ─────────────
function onContrastChange(val) {
  pdfContrast = parseInt(val);
  localStorage.setItem('nn_contrast', pdfContrast);
  document.getElementById('contrast-display').textContent = val + '%';
  activePreset = ''; localStorage.removeItem('nn_preset'); updatePresetUI();
  scheduleEnhancement();
}
function onBrightChange(val) {
  pdfBrightness = parseInt(val);
  localStorage.setItem('nn_brightness', pdfBrightness);
  document.getElementById('bright-display').textContent = val + '%';
  activePreset = ''; localStorage.removeItem('nn_preset'); updatePresetUI();
  scheduleEnhancement();
}
function toggleSharpness() {
  pdfSharpness = document.getElementById('sharp-toggle').checked;
  localStorage.setItem('nn_sharp', pdfSharpness ? '1' : '0');
  applyEnhancementToAll();
  showToast(pdfSharpness ? '✨ เพิ่มความคมแล้ว' : '✨ ปิดความคมแล้ว');
}
function resetTextSettings() {
  pdfContrast = 100; pdfBrightness = 100; pdfSharpness = false;
  localStorage.setItem('nn_contrast', '100');
  localStorage.setItem('nn_brightness', '100');
  localStorage.setItem('nn_sharp', '0');
  activePreset = ''; localStorage.removeItem('nn_preset'); updatePresetUI();
  document.getElementById('contrast-display').textContent = '100%';
  document.getElementById('bright-display').textContent = '100%';
  document.getElementById('contrast-slider').value = 100;
  document.getElementById('bright-slider').value = 100;
  document.getElementById('sharp-toggle').checked = false;
  applyEnhancementToAll();
  showToast('🔄 รีเซ็ตค่าตัวอักษรแล้ว');
}

// ── Reader tap to toggle bars ──────────────────────
function onReaderTap(e) {
  if (e.target.closest('button,a,.btn-settings-trigger')) return;
  toggleBars();
}
function toggleBars() {
  barsVisible = !barsVisible;
  setBarsVisible(barsVisible);
  if (barsVisible) scheduleAutoHide();
}
function setBarsVisible(v) {
  barsVisible = v;
  document.getElementById('reader-bar').classList.toggle('bar-hidden', !v);
  document.getElementById('reader-bottom').classList.toggle('bar-hidden', !v);
  document.getElementById('pdf-area').classList.toggle('bars-hidden', !v);
  if (!v) {
    const h = document.getElementById('tap-hint');
    if (h) { h.classList.add('show'); setTimeout(() => h.classList.remove('show'), 1400); }
  }
}
function scheduleAutoHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => setBarsVisible(false), 4000);
}

// ── Re-render visible pages at new scale ──────────────────────────────────────
// คงภาพ preview (CSS transform) ไว้ระหว่าง render หน้าใหม่ทั้งหมด แล้วค่อยสลับ
// เป็นภาพคม + จัด scroll ทีเดียว → ไม่ snap, ไม่กระพริบ, ไม่เลื่อนหน้า
async function _rerenderAtNewScale(scaleRatio, focal) {
  const area    = document.getElementById('pdf-area');
  const content = document.getElementById('pdf-content');
  if (!pdfDoc || !area) return;

  // กัน onscroll เปลี่ยนหน้า + ปิด native scroll-anchor ที่ตีกับการ set scrollTop ของเรา
  _restoring = true;
  const prevOverflowAnchor = area.style.overflowAnchor;
  area.style.overflowAnchor = 'none';

  // Freeze ความสูงของหน้าที่ render อยู่ (= ขนาดเดิม) ระหว่างวาดใหม่ → layout นิ่ง, preview ไม่กระตุก
  const rendered = _pageWrappers.filter(w => w._rendered);
  rendered.forEach(w => {
    w.style.height   = w.offsetHeight + 'px';
    w.style.overflow = 'hidden';
  });

  // วาดหน้าใหม่ทั้งหมด "ใต้" ภาพ preview แล้วรอจนเสร็จครบก่อน (กันความสูงขยับกลางคัน)
  const jobs = [];
  rendered.forEach(w => {
    w._rendered = false;
    w._origData = null;
    jobs.push(renderPageInto(parseInt(w.dataset.page), w));
  });
  await Promise.all(jobs);

  // ── ทุกอย่างพร้อมแล้ว → สลับเป็นภาพคม + จัด scroll ในเฟรมเดียว (atomic) ──
  // 1) อัปเดตความสูงประมาณของหน้าที่ยังไม่ render
  _estPageH = _baseScale > 0 ? Math.round(_basePageH * pdfScale / _baseScale) : Math.round(_estPageH * scaleRatio);
  _pageWrappers.forEach(w => { if (!w._rendered) w.style.minHeight = _estPageH + 'px'; });
  // 2) ปลด freeze ความสูง → หน้าโชว์ขนาดใหม่จริง
  rendered.forEach(w => { w.style.height = ''; w.style.overflow = ''; });
  // 3) ถอด preview transform (ตอนนี้ canvas ขนาดใหม่ = ขนาด preview พอดี → ไม่มี snap)
  if (content) { content.style.transform = ''; content.style.transformOrigin = ''; content.style.willChange = ''; }
  // 4) ยึด scroll ด้วย "หน้าจริง" ที่อยู่ใต้นิ้ว — วัดตำแหน่งจริงหลัง render เสร็จ
  //    (ภูมิคุ้มกันค่าความสูงประมาณของหน้าที่ยังไม่ render → ไม่ขยับ/ไม่เด้ง)
  const aw = _pageWrappers.find(w => parseInt(w.dataset.page) === _pinch.anchorPage);
  if (aw) {
    const aRect = area.getBoundingClientRect();
    const wRect = aw.getBoundingClientRect();
    if (horizMode) {
      const focalOnScreen = (wRect.left - aRect.left) + _pinch.anchorFrac * wRect.width;
      area.scrollLeft += (focalOnScreen - _pinch.viewportX);
    } else {
      const focalOnScreen = (wRect.top - aRect.top) + _pinch.anchorFrac * wRect.height;
      area.scrollTop += (focalOnScreen - _pinch.viewportY);
    }
  } else if (focal) {
    area.scrollTop = Math.max(0, focal.contentY - focal.viewY);
  }

  // คืน state — หน่วงเล็กน้อยให้ layout settle ก่อนเปิด onscroll page-tracking อีกครั้ง
  area.style.overflowAnchor = prevOverflowAnchor;
  setTimeout(() => { _restoring = false; }, 120);
}

// ── Custom Pinch-to-Zoom ────────────────────────────────────────────────────
// CSS transform on #pdf-content during gesture (smooth, centered on fingers),
// then re-renders at updated pdfScale + pdfWidth on release.
let _pinch = { active: false, startDist: 0, startScale: 1, startWidth: 88, startCanvasW: 0, originX: 0, originY: 0, viewportX: 0, viewportY: 0, anchorPage: 1, anchorFrac: 0, curRatio: 1 };
let _pinchRerenderTimer = null;
let _pinchRAF = 0;

function _pinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function _clearPinchTransform(content) {
  if (!content) return;
  content.style.transform = '';
  content.style.transformOrigin = '';
  content.style.willChange = '';
}

function _onPinchStart(e) {
  if (sizeLocked || e.touches.length !== 2) return;
  e.preventDefault();
  const area = document.getElementById('pdf-area');
  _pinch.active     = true;
  _pinch.startDist  = _pinchDist(e.touches);
  _pinch.startScale = pdfScale;
  _pinch.startWidth = pdfWidth;
  _pinch.curRatio   = 1;
  // วัดความกว้างจริงบนจอ ณ ตอนนี้ → ใช้เป็น "แหล่งความจริงเดียว" (กัน min() cap เพี้ยน)
  const refCanvas = document.querySelector('#pdf-content canvas');
  _pinch.startCanvasW = refCanvas ? refCanvas.getBoundingClientRect().width : 0;
  const rect = area.getBoundingClientRect();
  const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
  const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  // viewport coords ของจุดกึ่งกลางนิ้ว (ใช้ anchor scroll หลัง re-render)
  _pinch.viewportX = mx - rect.left;
  _pinch.viewportY = my - rect.top;
  // content coords (รวม scroll) สำหรับ transform-origin
  _pinch.originX = _pinch.viewportX + area.scrollLeft;
  _pinch.originY = _pinch.viewportY + area.scrollTop;
  // ── Element anchor: จับ "หน้าจริง" ที่อยู่ใต้นิ้ว + ตำแหน่งสัดส่วนในหน้านั้น ──
  // ใช้วัดตำแหน่งจริงหลัง render (ภูมิคุ้มกันค่าความสูงประมาณของหน้าที่ยังไม่โหลด)
  _pinch.anchorPage = curPage || 1;
  _pinch.anchorFrac = 0;
  const fp = horizMode ? _pinch.viewportX : _pinch.viewportY;
  for (const w of _pageWrappers) {
    const r = w.getBoundingClientRect();
    const s = (horizMode ? r.left : r.top)    - (horizMode ? rect.left : rect.top);
    const e2 = (horizMode ? r.right : r.bottom) - (horizMode ? rect.left : rect.top);
    if (fp >= s && fp <= e2) {
      _pinch.anchorPage = parseInt(w.dataset.page);
      _pinch.anchorFrac = (fp - s) / Math.max(1, e2 - s);
      break;
    }
  }
  const content = document.getElementById('pdf-content');
  if (content) {
    content.style.transformOrigin = `${_pinch.originX}px ${_pinch.originY}px`;
    content.style.willChange = 'transform';
  }
}

function _onPinchMove(e) {
  if (!_pinch.active || e.touches.length !== 2) return;
  e.preventDefault();
  const ratio = _pinchDist(e.touches) / _pinch.startDist;
  _pinch.curRatio = Math.max(0.25, Math.min(4.0, ratio));
  // rAF throttle → ไม่ apply transform ถี่เกิน refresh rate (กันกระตุก)
  if (_pinchRAF) return;
  _pinchRAF = requestAnimationFrame(() => {
    _pinchRAF = 0;
    if (!_pinch.active) return;
    const content = document.getElementById('pdf-content');
    if (content) content.style.transform = `scale(${_pinch.curRatio})`;
  });
}

function _onPinchEnd(e) {
  if (!_pinch.active) return;
  const content = document.getElementById('pdf-content');
  const area    = document.getElementById('pdf-area');

  if (_pinchRAF) { cancelAnimationFrame(_pinchRAF); _pinchRAF = 0; }

  // 3+ นิ้ว → ยกนิ้วหนึ่งออกแต่ยังเหลือ 2 — ยกเลิก gesture นี้ clean
  if (e.touches.length >= 2) {
    _pinch.active = false;
    _clearPinchTransform(content);
    return;
  }

  _pinch.active = false;
  const ratio = _pinch.curRatio;
  if (Math.abs(ratio - 1) < 0.04) {
    _clearPinchTransform(content);
    return;
  }

  // ── แหล่งความจริงเดียว: ขนาดมาจาก pdfScale เท่านั้น, pdfWidth (cap) คำนวณตามให้ไม่ตัด ──
  let newScale = parseFloat(Math.max(0.5, Math.min(3.0, _pinch.startScale * ratio)).toFixed(2));

  // ความกว้างเป้าหมายบนจอ = ความกว้างจริงตอนเริ่ม × อัตราส่วน scale ที่เกิดขึ้นจริง (หลัง clamp)
  const containerW = content ? content.clientWidth : (area ? area.clientWidth : 0);
  const startCanvasW = _pinch.startCanvasW || 0;
  if (startCanvasW > 0 && containerW > 0) {
    const targetW = startCanvasW * (newScale / _pinch.startScale);
    // ตั้ง cap (pdfWidth%) ให้ ≥ targetW เสมอ → min() ไม่มีวันไปตัด scale width
    let neededPct = Math.ceil((targetW / containerW) * 100) + 1;
    pdfWidth = Math.max(30, Math.min(200, neededPct));
    // ถ้า cap ชน 200% แล้วยังเล็กกว่า targetW → ลด scale ลงให้พอดี cap (กัน preview≠result ที่ขอบสุด)
    const capW = (pdfWidth / 100) * containerW;
    if (capW < targetW && _pinch.startScale > 0) {
      newScale = parseFloat(Math.max(0.5, (newScale * capW / targetW)).toFixed(2));
    }
  } else {
    // ไม่มี reference canvas → fallback แบบเดิม
    pdfWidth = Math.max(30, Math.min(200, Math.round(_pinch.startWidth * ratio)));
  }

  pdfScale = newScale;
  localStorage.setItem(scaleKey(), pdfScale);
  localStorage.setItem(widthKey(), pdfWidth);
  updateScaleDisplay();
  const wd = document.getElementById('width-display');
  const ws = document.getElementById('width-slider');
  if (wd) wd.textContent = pdfWidth + '%';
  if (ws) ws.value = Math.min(pdfWidth, 100);

  if (!pdfDoc) { _clearPinchTransform(content); return; }

  const actualRatio = newScale / _pinch.startScale;

  // ── Immediate visual lock-in (synchronous, no double-zoom) ──────────────────
  // 1) Capture each canvas's RENDERED size (includes CSS transform) BEFORE
  //    clearing the transform — these are the correct zoomed pixel values.
  const canvasSnap = [];
  document.querySelectorAll('#pdf-content canvas').forEach(c => {
    const r = c.getBoundingClientRect();
    canvasSnap.push({ c, w: r.width, h: r.height });
  });
  // 2) Clear the transform NOW so there is no double-scaling.
  _clearPinchTransform(content);
  // 3) Stamp the zoomed dimensions directly onto each canvas — zoom is now
  //    baked in without any CSS transform, so it can't snap back.
  canvasSnap.forEach(({ c, w, h }) => {
    c.style.width    = w + 'px';
    c.style.height   = h + 'px';
    c.style.maxWidth = pdfWidth + '%';
  });

  // focal point ในพิกัด content ใหม่ (= พิกัดเดิม × ratio) — ใช้ยึด scroll หลัง render
  const focal = {
    contentX: _pinch.originX * actualRatio,
    contentY: _pinch.originY * actualRatio,
    viewX:    _pinch.viewportX,
    viewY:    _pinch.viewportY,
  };

  area.style.overflowX = (pdfWidth > 100 && !horizMode) ? 'auto' : '';

  // Async re-render replaces blurry stretched canvases with sharp ones
  clearTimeout(_pinchRerenderTimer);
  _rerenderAtNewScale(actualRatio, focal);
}

function _blockGesture(e) { e.preventDefault(); }

function initPinchHandler() {
  const area = document.getElementById('pdf-area');
  if (!area || area._pinchBound) return;
  area._pinchBound = true;
  area.addEventListener('touchstart',  _onPinchStart, { passive: false });
  area.addEventListener('touchmove',   _onPinchMove,  { passive: false });
  area.addEventListener('touchend',    _onPinchEnd,   { passive: false });
  area.addEventListener('touchcancel', _onPinchEnd,   { passive: false });
  document.addEventListener('gesturestart',  _blockGesture, { passive: false });
  document.addEventListener('gesturechange', _blockGesture, { passive: false });
}

function toggleSizeLock() {
  sizeLocked = !sizeLocked;
  localStorage.setItem('nn_sizelock', sizeLocked ? '1' : '0');
  applySizeLockUI(); // applySizeLockUI set zoom-locked class อยู่แล้ว
  showToast(sizeLocked ? '🔒 ล็อคซูมแล้ว' : '🔓 ปลดล็อคซูมแล้ว');
}

function stopVpLock() { /* no-op */ }

function applySizeLockUI() {
  const toggle = document.getElementById('lock-toggle');
  if (toggle) toggle.checked = sizeLocked;
  const sl = document.getElementById('scale-slider');
  const ws = document.getElementById('width-slider');
  if (sl) sl.disabled = sizeLocked;
  if (ws) ws.disabled = sizeLocked;
  const note = document.getElementById('lock-note');
  if (note) note.classList.toggle('show', sizeLocked);
  const lockBtn = document.getElementById('btn-lock-bar');
  if (lockBtn) {
    lockBtn.textContent = sizeLocked ? '🔒' : '🔓';
    lockBtn.classList.toggle('locked', sizeLocked);
  }
  const area = document.getElementById('pdf-area');
  if (area) area.classList.toggle('zoom-locked', sizeLocked);
}
function showLockBtn(_v) { /* no-op (legacy) */ }

// ── Drawer tabs ─────────────────────────────────
function setDrawerTab(tab) {
  activeDrawerTab = tab;
  document.querySelectorAll('.drawer-tab').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab));
  document.getElementById('panel-read').style.display  = tab === 'read'  ? 'block' : 'none';
  document.getElementById('panel-marks').style.display = tab === 'marks' ? 'block' : 'none';
  document.getElementById('panel-stats').style.display = tab === 'stats' ? 'block' : 'none';
}

// ── Wake Lock ───────────────────────────────────
async function acquireWakeLock() {
  if (!wakeLockSupported || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) { console.warn('Wake lock error:', err); }
}
function releaseWakeLock() {
  if (wakeLock) { try { wakeLock.release(); } catch {} wakeLock = null; }
}
function toggleWakeLock() {
  wakeWanted = document.getElementById('wake-toggle').checked;
  localStorage.setItem('nn_wake', wakeWanted ? '1' : '0');
  if (wakeWanted) { acquireWakeLock(); showToast('💡 จอจะไม่ดับขณะอ่าน'); }
  else { releaseWakeLock(); showToast('💤 ปิดการล็อคจอแล้ว'); }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // แอปถูก background → save ทันทีด้วย keepalive (request ยังส่งแม้หน้าถูกปิด)
    if (curNovelId && curPage) saveProgress(curNovelId, curPage, totalPages, true);
  }
  if (document.visibilityState === 'visible' && wakeWanted &&
      document.body.classList.contains('reader-open')) {
    acquireWakeLock();
  }
});
window.addEventListener('pagehide', () => {
  if (curNovelId && curPage) saveProgress(curNovelId, curPage, totalPages, true);
});

// ── Sliders ─────────────────────────────────────
let sliderTimer = null;
function onScaleSliderChange(val) {
  if (sizeLocked) {
    showToast('🔒 ปลดล็อคก่อน');
    document.getElementById('scale-slider').value = Math.round(pdfScale*100);
    return;
  }
  pdfScale = parseInt(val) / 100;
  localStorage.setItem(scaleKey(), pdfScale);
  document.getElementById('scale-display').textContent = val + '%';
  clearTimeout(sliderTimer);
  sliderTimer = setTimeout(() => { if (pdfDoc) renderAllPages(curPage); }, 350);
}
function onScaleSliderCommit() {
  if (sizeLocked) return;
  clearTimeout(sliderTimer); // ยกเลิก debounce ที่ค้างอยู่
  if (pdfDoc) renderAllPages(curPage);
}
function onWidthSliderChange(val) {
  if (sizeLocked) {
    showToast('🔒 ปลดล็อคก่อน');
    document.getElementById('width-slider').value = pdfWidth;
    return;
  }
  pdfWidth = parseInt(val);
  localStorage.setItem(widthKey(), pdfWidth);
  document.getElementById('width-display').textContent = pdfWidth + '%';
  document.querySelectorAll('.page-wrapper canvas').forEach(c => c.style.maxWidth = pdfWidth + '%');
}

async function fitToScreen() {
  if (sizeLocked) { showToast('🔒 ปลดล็อคก่อนนะครับ'); return; }
  if (!pdfDoc) return;
  try {
    const page = await pdfDoc.getPage(curPage || 1);
    const vp = page.getViewport({ scale: 1 });
    const areaW = document.getElementById('pdf-area').clientWidth;
    // ถ้า auto-crop เปิดอยู่ ให้ fit กับความกว้างของเนื้อหา (ไม่นับ margin)
    const cropFrac = (autoCropEnabled && autoCrop) ? (1 - autoCrop.left - autoCrop.right) : 1;
    const newScale = parseFloat((areaW / (vp.width * cropFrac)).toFixed(2));
    pdfScale = Math.max(0.5, Math.min(3.0, newScale));
    pdfWidth = 100;
    localStorage.setItem(scaleKey(), pdfScale);
    localStorage.setItem(widthKey(), pdfWidth);
    const pct = Math.round(pdfScale * 100);
    document.getElementById('scale-display').textContent = pct + '%';
    document.getElementById('scale-slider').value = pct;
    document.getElementById('width-display').textContent = '100%';
    document.getElementById('width-slider').value = 100;
    await renderAllPages(curPage || 1);
    showToast('📐 ปรับพอดีหน้าจอแล้ว');
  } catch(e) { console.error(e); }
}

function updateScaleDisplay() {
  const v = Math.round(pdfScale * 100);
  const sl = document.getElementById('scale-slider');
  const dp = document.getElementById('scale-display');
  if (sl) sl.value = v;
  if (dp) dp.textContent = v + '%';
}
function adjustScale(d) {
  if (sizeLocked) { showToast('🔒 ปลดล็อคก่อนนะครับ'); return; }
  pdfScale = Math.max(.5, Math.min(3, pdfScale+d));
  localStorage.setItem(scaleKey(), pdfScale); updateScaleDisplay();
  if (pdfDoc) renderAllPages(curPage);
}
function adjustWidth(d) {
  if (sizeLocked) { showToast('🔒 ปลดล็อคก่อนนะครับ'); return; }
  pdfWidth = Math.max(30, Math.min(100, pdfWidth+d));
  localStorage.setItem(widthKey(), pdfWidth);
  const dp = document.getElementById('width-display');
  const sl = document.getElementById('width-slider');
  if (dp) dp.textContent = pdfWidth+'%';
  if (sl) sl.value = pdfWidth;
  document.querySelectorAll('.page-wrapper canvas').forEach(c => c.style.maxWidth = pdfWidth+'%');
}

function toggleHoriz() {
  horizMode = document.getElementById('horiz-toggle').checked;
  localStorage.setItem('nn_horiz', horizMode ? '1' : '0');
  if (pdfDoc) renderAllPages(curPage);
}

// ── Bookmarks ──────────────────────────────────────
function getBM(novelId) { return JSON.parse(localStorage.getItem('nn_bm_'+novelId)||'[]'); }
function saveBM(novelId, arr) { localStorage.setItem('nn_bm_'+novelId, JSON.stringify(arr)); }
function addBookmark() {
  const bm = getBM(curNovelId);
  if (!bm.includes(curPage)) { bm.push(curPage); bm.sort((a,b)=>a-b); saveBM(curNovelId, bm); }
  renderBookmarkList(); showToast(`🔖 บุ๊กมาร์กหน้า ${curPage} แล้ว`);
}
function removeBookmark(page) {
  const bm = getBM(curNovelId).filter(p => p !== page);
  saveBM(curNovelId, bm); renderBookmarkList();
}
function renderBookmarkList() {
  const list = document.getElementById('bookmark-list');
  if (!list) return;
  if (!curNovelId) { list.innerHTML = ''; return; }
  const bm = getBM(curNovelId);
  if (bm.length === 0) {
    list.innerHTML = '<div style="font-size:.85rem;color:var(--cp-ink-soft);padding:8px 0;font-weight:600">ยังไม่มี bookmark</div>';
    return;
  }
  list.innerHTML = bm.map(p => `
    <div class="bookmark-item" onclick="jumpToPage(${p})">
      <span>📌 หน้า ${p}</span>
      <button class="btn-bm-del" onclick="event.stopPropagation();removeBookmark(${p})">✕</button>
    </div>`).join('');
}
function jumpToPage(page) {
  const p = Math.max(1, Math.min(totalPages, parseInt(page) || 1));
  const w = _pageWrappers[p - 1];
  if (!w) return;
  closeSettings();
  _restoring = true;
  w.scrollIntoView({ behavior: 'auto', block: 'start' });
  curPage = p;
  document.getElementById('page-counter').textContent = `${p} / ${totalPages}`;
  document.getElementById('bm-cur-page').textContent = p;
  updateScrubber(p);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProgress(curNovelId, p, totalPages), 1500);
  setTimeout(() => { _restoring = false; }, 600);
}

function updateScrubber(page) {
  if (!totalPages) return;
  const pct = ((page - 1) / Math.max(1, totalPages - 1)) * 100;
  const fill  = document.getElementById('scrubber-fill');
  const thumb = document.getElementById('scrubber-thumb');
  if (fill)  fill.style.width = pct + '%';
  if (thumb) thumb.style.left = pct + '%';
}

function initScrubber() {
  const wrap  = document.getElementById('scrubber-wrap');
  const track = document.getElementById('scrubber-track');
  const tip   = document.getElementById('scrubber-tip');
  if (!wrap || !track) return;
  if (wrap._scrubBound) return; // ป้องกัน listener ซ้ำ
  wrap._scrubBound = true;

  function pageFromX(clientX) {
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(1 + ratio * (totalPages - 1));
  }
  function moveTo(clientX) {
    const p = pageFromX(clientX);
    const pct = ((p - 1) / Math.max(1, totalPages - 1)) * 100;
    document.getElementById('scrubber-fill').style.width  = pct + '%';
    document.getElementById('scrubber-thumb').style.left  = pct + '%';
    tip.style.left    = pct + '%';
    tip.style.opacity = '1';
    tip.textContent   = `หน้า ${p}`;
    return p;
  }

  let _dragging = false;

  wrap.addEventListener('pointerdown', e => {
    e.stopPropagation();
    _dragging = true;
    wrap.classList.add('dragging');
    wrap.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
  });
  wrap.addEventListener('pointermove', e => {
    if (!_dragging) return;
    moveTo(e.clientX);
  });
  wrap.addEventListener('pointerup', e => {
    if (!_dragging) return;
    _dragging = false;
    wrap.classList.remove('dragging');
    tip.style.opacity = '0';
    const p = moveTo(e.clientX);
    jumpToPage(p);
  });
  wrap.addEventListener('pointercancel', () => {
    _dragging = false;
    wrap.classList.remove('dragging');
    tip.style.opacity = '0';
  });
}

function openPageJump() {
  if (!pdfDoc) return;
  const counter = document.getElementById('page-counter');
  // แทนที่ตัวเลขด้วย input ชั่วคราว
  const prev = counter.textContent;
  counter.innerHTML = `<input id="pj-input" type="number" min="1" max="${totalPages}"
    style="width:70px;border:none;outline:none;background:transparent;font:inherit;
    color:inherit;text-align:center;font-weight:700;" placeholder="${curPage}">`;
  const inp = document.getElementById('pj-input');
  inp.focus(); inp.select();
  const done = () => {
    const val = parseInt(inp.value);
    counter.textContent = prev;
    if (val >= 1 && val <= totalPages) jumpToPage(val);
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); done(); }
    if (e.key === 'Escape') { counter.textContent = prev; }
  });
  inp.addEventListener('blur', done);
}

// ── Settings drawer ────────────────────────────────
function openSettings() {
  updateScaleDisplay();
  const wd = document.getElementById('width-display');
  const ws = document.getElementById('width-slider');
  if (wd) wd.textContent = pdfWidth + '%';
  if (ws) ws.value = pdfWidth;
  document.getElementById('contrast-display').textContent = pdfContrast + '%';
  document.getElementById('contrast-slider').value = pdfContrast;
  document.getElementById('bright-display').textContent = pdfBrightness + '%';
  document.getElementById('bright-slider').value = pdfBrightness;
  document.getElementById('sharp-toggle').checked = pdfSharpness;
  document.getElementById('bm-cur-page').textContent = curPage || '-';
  renderBookmarkList();
  applyPageColorUI();
  applySizeLockUI();
  updatePresetUI();
  // sync warm + autocrop controls
  const warmS = document.getElementById('warm-slider');
  if (warmS) warmS.value = warmTint;
  const warmD = document.getElementById('warm-display');
  if (warmD) warmD.textContent = warmTint + '%';
  const cropT = document.getElementById('autocrop-toggle');
  if (cropT) cropT.checked = autoCropEnabled;
  const inReader = document.body.classList.contains('reader-open');
  setDrawerTab(inReader ? (activeDrawerTab || 'read') : 'stats');
  clearTimeout(hideTimer);
  setBarsVisible(true);
  document.getElementById('settings-overlay').classList.add('open');
  document.getElementById('settings-drawer').classList.add('open');
}
function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
  document.getElementById('settings-drawer').classList.remove('open');
  if (document.getElementById('reader-page').classList.contains('open')) scheduleAutoHide();
}

// ── Swipe-down to close drawer ───────────────────
(function() {
  let startY = 0, dragging = false, currentDelta = 0;
  const getDrawer = () => document.getElementById('settings-drawer');
  function onStart(e) {
    if (!getDrawer().classList.contains('open')) return;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    dragging = true; currentDelta = 0;
    getDrawer().style.transition = 'none';
  }
  function onMove(e) {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const d = y - startY;
    if (d < 0) return;
    currentDelta = d;
    getDrawer().style.transform = `translateY(${d}px)`;
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    getDrawer().style.transition = '';
    getDrawer().style.transform = '';
    if (currentDelta > 90) closeSettings();
  }
  window.addEventListener('DOMContentLoaded', () => {
    const h = document.getElementById('drawer-handle');
    if (!h) return;
    h.addEventListener('touchstart', onStart, { passive: true });
    h.addEventListener('touchmove', onMove, { passive: true });
    h.addEventListener('touchend', onEnd);
    h.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  });
})();

// ── Upload ─────────────────────────────────────────
function openUpload() { document.getElementById('upload-modal').classList.add('open'); }
function closeUpload() {
  document.getElementById('upload-modal').classList.remove('open');
  document.getElementById('upload-prog').style.display = 'none';
  document.getElementById('prog-fill').style.width = '0%';
  document.getElementById('file-input').value = '';
}
async function handleFile(e) {
  const file = e.target.files[0]; if (!file) return;
  if (file.type !== 'application/pdf') { showToast('รองรับเฉพาะ .pdf'); return; }
  await uploadNovel(file);
}
async function uploadNovel(file) {
  const pe = document.getElementById('upload-prog');
  const fe = document.getElementById('prog-fill');
  const le = document.getElementById('prog-label');
  pe.style.display = 'block'; le.textContent = 'กำลังอัปโหลด...'; fe.style.width = '15%';
  try {
    const title = file.name.replace(/\.pdf$/i,'').replace(/[_\-]+/g,' ').trim();
    const fileName = `novel_${Date.now()}.pdf`;
    fe.style.width = '40%';
    await storageUpload(fileName, file);
    fe.style.width = '70%'; le.textContent = 'บันทึกข้อมูล...';
    const rows = await dbPost('novels', { title, file_url:fileName, file_size:file.size }, 'return=representation');
    fe.style.width = '90%'; le.textContent = 'บันทึกออฟไลน์...';
    // บันทึก PDF ที่อยู่ใน memory แล้วลง Cache API ทันที (ไม่ต้องโหลดซ้ำ)
    if ('caches' in window && rows?.[0]?.id) {
      try {
        const cache = await caches.open(PDF_CACHE_NAME);
        await cache.put('pdf-' + rows[0].id, new Response(file, { headers: { 'Content-Type': 'application/pdf' } }));
        localStorage.setItem('nn_pin_' + rows[0].id, '1');
      } catch(_) {}
    }
    fe.style.width = '100%'; le.textContent = '✅ อัปโหลดสำเร็จ!';
    setTimeout(() => { closeUpload(); loadNovels(); showToast(`เพิ่ม "${title}" แล้ว! 📶 บันทึกออฟไลน์แล้ว`); }, 900);
  } catch(err) {
    console.error(err); le.textContent = '❌ ' + err.message; showToast('อัปโหลดล้มเหลว');
  }
}

// Drag & drop on upload modal
window.addEventListener('DOMContentLoaded', () => {
  const dz = document.getElementById('drop-zone');
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      const f=e.dataTransfer.files[0]; if(f) handleFile({target:{files:e.dataTransfer.files}});
    });
  }
});

// ── Helpers ────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s).replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }

function scrollToTop() {
  window.scrollTo({ top:0, behavior:'smooth' });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('streak-modal').classList.contains('open')) closeStreakModal();
    else if (document.getElementById('rename-modal').classList.contains('open')) closeRename();
    else if (document.getElementById('upload-modal').classList.contains('open')) closeUpload();
    else if (document.getElementById('confirm-modal').classList.contains('open')) closeConfirm();
    else if (document.getElementById('settings-drawer').classList.contains('open')) closeSettings();
    else if (pdfDoc) closeReader();
  }
  if (e.key === 'Enter' && document.getElementById('rename-modal').classList.contains('open')) doRename();
});

window.addEventListener('popstate', () => {
  if (document.getElementById('reader-page').classList.contains('open')) closeReader();
});

// Close modals via overlay click
['upload-modal','confirm-modal','rename-modal','streak-modal'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', e => {
    if (e.target === el) el.classList.remove('open');
  });
});

// ── Service Worker ────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Install Prompt (Android/Chrome) ──────────────
let _installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  const banner = document.getElementById('install-banner');
  if (banner && !localStorage.getItem('nn_install_dismissed')) {
    banner.classList.add('show');
  }
});
window.addEventListener('appinstalled', () => {
  const banner = document.getElementById('install-banner');
  if (banner) banner.classList.remove('show');
  _installPrompt = null;
});
async function promptInstall() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  const { outcome } = await _installPrompt.userChoice;
  _installPrompt = null;
  document.getElementById('install-banner').classList.remove('show');
  if (outcome === 'accepted') showToast('✅ ติดตั้งแล้ว!');
}
function dismissInstallBanner() {
  document.getElementById('install-banner').classList.remove('show');
  localStorage.setItem('nn_install_dismissed', '1');
}

// ── Init ───────────────────────────────────────────
updateStreakUI();
loadNovels();
