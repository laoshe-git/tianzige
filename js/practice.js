// 自由练习：出一个字，孩子在大格子里自己写（不提示、不判对错）；写好一遍存一遍，写够遍数换下一个，最后看作业。
// 笔迹按格子归一化（0–1000）存成整数，换屏幕大小、转屏、缩略图都能原样重画。
// 依赖 js/strokes.js 暴露的 TZ（字形数据、田字格、语音、笔顺页）。
(() => {
  const $ = (id) => document.getElementById(id);
  const INK_KEY = "tz-ink", PR_KEY = "tz-practice";
  const MAX_PER_CHAR = 8;                    // 每个字最多留 8 遍
  const SESSION_TTL = 20 * 3600 * 1000;      // 同一份作业 20 小时内算同一次
  const PRAISE = ["写得真好！", "真棒！", "很认真！", "再写一个！"];
  const INK_COLOR = "#1d1d1f", TRACE_COLOR = "#f08080";

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const pr = Object.assign({ target: 3, template: "trace", session: null }, load(PR_KEY, {}));
  let inkStore = load(INK_KEY, {});
  let hooks = { color: () => "#3a9a5b", grid: () => "tian" };
  let cur = null;          // { item, glyph, strokes, cleared, S }
  let showTok = null, busy = false;

  // ---------- 存储 ----------
  const savePr = () => { try { localStorage.setItem(PR_KEY, JSON.stringify(pr)); } catch { /* 太满也不影响写字 */ } };
  function saveInk() {
    for (let i = 0; i < 100; i++) {
      try { localStorage.setItem(INK_KEY, JSON.stringify(inkStore)); return true; }
      catch { if (!trimOldest()) return false; }
    }
    return false;
  }
  // 存满了：先删不在本次作业里、最久没写的字；还不够再删最老的一遍
  function trimOldest() {
    const inList = new Set((pr.session?.list || []).map((x) => x.ch));
    const chars = Object.keys(inkStore).filter((c) => inkStore[c]?.length);
    if (!chars.length) return false;
    const last = (c) => Math.max(...inkStore[c].map((a) => a.t));
    const others = chars.filter((c) => !inList.has(c)).sort((a, b) => last(a) - last(b));
    if (others.length) { delete inkStore[others[0]]; return true; }
    let oc = chars[0];
    for (const c of chars) if (inkStore[c][0].t < inkStore[oc][0].t) oc = c;
    inkStore[oc].shift();
    if (!inkStore[oc].length) delete inkStore[oc];
    return true;
  }
  const sessionAttempts = (ch) => (inkStore[ch] || []).filter((a) => a.t >= pr.session.start);
  function addAttempt(ch, strokes) {
    const list = inkStore[ch] || (inkStore[ch] = []);
    list.push({ t: Date.now(), s: strokes });
    while (list.length > MAX_PER_CHAR) list.shift();
    saveInk();
  }
  function saveDraft() {
    pr.session.draft = cur && cur.strokes.length ? { ch: cur.item.ch, strokes: cur.strokes } : null;
    savePr();
  }
  // 换字或看作业前，把没按“写好了”的笔迹也存成一遍，不丢孩子写的
  function commitDraft() {
    if (!cur || !cur.strokes.length) return;
    addAttempt(cur.item.ch, cur.strokes);
    cur.strokes = []; cur.cleared = null;
    saveDraft();
  }

  // ---------- 字形 ----------
  const glyphCache = {};
  async function glyphOf(ch) {
    if (glyphCache[ch]) return glyphCache[ch];
    let g;
    try { g = { ch, paths: (await TZ.loadStroke(ch)).s, digit: TZ.isDigit(ch) }; }
    catch { g = { ch, paths: null, digit: false }; }      // 没有笔顺数据（或断网没缓存）就用楷体字
    return (glyphCache[ch] = g);
  }
  function drawGlyph(svg, glyph, size, fill, opacity = 1) {
    if (glyph.paths) {
      const T = TZ.dataTransform(0, 0, size, glyph.digit ? 0 : size * 0.08);
      const g = TZ.el("g", { transform: T.attr, fill, opacity, class: "glyph" }, svg);
      for (const d of glyph.paths) TZ.el("path", { d }, g);
    } else {
      const fs = size * 0.8;
      const t = TZ.el("text", { x: size / 2, y: size / 2 + fs * 0.31, "font-size": fs, "text-anchor": "middle", class: "glyph",
                                "font-family": "TZKai, 'Kaiti SC', STKaiti, serif", fill, opacity }, svg);
      t.textContent = glyph.ch;
    }
  }

  // ---------- 笔迹 ----------
  // 相邻点取中点做二次曲线，线条圆润；一个点就画成圆点
  function inkPath(st, k) {
    const n = st.length / 2, f = (v) => (v * k).toFixed(1);
    if (n === 1) return `M${f(st[0])} ${f(st[1])}h0.1`;
    let d = `M${f(st[0])} ${f(st[1])}`;
    for (let i = 1; i < n - 1; i++)
      d += `Q${f(st[2 * i])} ${f(st[2 * i + 1])} ${f((st[2 * i] + st[2 * i + 2]) / 2)} ${f((st[2 * i + 1] + st[2 * i + 3]) / 2)}`;
    return d + `L${f(st[2 * n - 2])} ${f(st[2 * n - 1])}`;
  }
  // 抽稀（Ramer–Douglas–Peucker），存得少、画得一样
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1;
      let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  const lineWidth = (S) => S * 0.05;

  function redraw() {
    const cv = $("prCanvas"); if (!cv || !cur) return;
    const c = cv.getContext("2d"), S = cur.S, dpr = cv.width / S;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, S, S);
    c.lineCap = c.lineJoin = "round"; c.strokeStyle = INK_COLOR; c.lineWidth = lineWidth(S);
    for (const st of cur.strokes) c.stroke(new Path2D(inkPath(st, S / 1000)));
    $("prUndo").disabled = !cur.strokes.length && !cur.cleared;
    $("prClear").disabled = !cur.strokes.length;
    $("prPage").dataset.strokes = cur.strokes.length;
  }

  // 手指、Apple Pencil 都能写；用笔时忽略手掌
  function bindCanvas(cv) {
    let drawing = null, penUntil = 0;
    const toPt = (e) => {
      const r = cv.getBoundingClientRect();
      return [Math.round(Math.max(-50, Math.min(1050, (e.clientX - r.left) / r.width * 1000))),
              Math.round(Math.max(-50, Math.min(1050, (e.clientY - r.top) / r.height * 1000)))];
    };
    const c = () => cv.getContext("2d");
    function add(e) {
      const p = toPt(e), pts = drawing.pts, last = pts[pts.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return;
      pts.push(p);
      if (!last) return;
      const k = cur.S / 1000, g = c();
      g.beginPath(); g.moveTo(last[0] * k, last[1] * k); g.lineTo(p[0] * k, p[1] * k); g.stroke();
    }
    cv.addEventListener("pointerdown", (e) => {
      if (busy) return;
      if (e.pointerType === "pen") {
        penUntil = Infinity;
        if (drawing && drawing.type === "touch") { drawing = null; redraw(); }   // 手掌先碰到屏幕：丢掉
      } else if (e.pointerType === "touch" && performance.now() < penUntil) return;
      if (drawing) return;                     // 第二根手指不画
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch { /* 合成事件没有真指针 */ }
      drawing = { id: e.pointerId, type: e.pointerType, pts: [] };
      const g = c(); g.lineCap = g.lineJoin = "round"; g.strokeStyle = INK_COLOR; g.lineWidth = lineWidth(cur.S);
      add(e);
      const [x, y] = drawing.pts[0], k = cur.S / 1000;
      g.beginPath(); g.moveTo(x * k, y * k); g.lineTo(x * k + 0.1, y * k); g.stroke();
    });
    cv.addEventListener("pointermove", (e) => {
      if (e.pointerType === "pen" && !drawing) penUntil = Math.max(penUntil === Infinity ? 0 : penUntil, performance.now() + 1500);
      if (!drawing || e.pointerId !== drawing.id) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of evs.length ? evs : [e]) add(ev);
    });
    const end = (e) => {
      if (e.pointerType === "pen") penUntil = performance.now() + 1500;
      if (!drawing || e.pointerId !== drawing.id) return;
      const pts = simplify(drawing.pts, 2);
      drawing = null;
      cur.strokes.push(pts.flat());
      cur.cleared = null;
      redraw(); saveDraft();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
  }

  // ---------- 页面 ----------
  function stageSize() {
    const vw = innerWidth, vh = innerHeight;
    const S = vw > vh ? Math.min(vh - 230, vw - 400, 700) : Math.min(vw - 40, vh - 590, 700);
    return Math.max(240, Math.floor(S));
  }
  function buildStage() {
    const S = stageSize(), st = $("prStage");
    cur.S = S;
    st.textContent = "";
    st.style.width = st.style.height = S + "px";
    TZ.gridSvg(S, hooks.color(), st, hooks.grid() === "mi");
    const tpl = TZ.el("svg", { id: "prTplLayer", width: S, height: S, viewBox: `0 0 ${S} ${S}` }, st);
    drawGlyph(tpl, cur.glyph, S, TRACE_COLOR, 0.42);
    tpl.style.display = pr.template === "trace" ? "" : "none";
    const cv = document.createElement("canvas");
    const dpr = Math.min(3, devicePixelRatio || 1);
    cv.id = "prCanvas"; cv.width = cv.height = Math.round(S * dpr);
    cv.style.width = cv.style.height = S + "px";
    st.appendChild(cv);
    bindCanvas(cv);
    redraw();
  }
  function thumb(attempt, glyph, size) {
    const svg = TZ.gridSvg(size, hooks.color());
    drawGlyph(svg, glyph, size, "#dcdcdc");
    const g = TZ.el("g", { fill: "none", stroke: INK_COLOR, "stroke-width": lineWidth(size), "stroke-linecap": "round", "stroke-linejoin": "round", class: "ink" }, svg);
    for (const st of attempt.s) TZ.el("path", { d: inkPath(st, size / 1000) }, g);
    svg.classList.add("thumb");
    return svg;
  }
  function renderModel() {
    const box = $("prModel"); box.textContent = "";
    const svg = TZ.gridSvg(150, hooks.color(), box, hooks.grid() === "mi");
    drawGlyph(svg, cur.glyph, 150, INK_COLOR);
  }
  function renderStars() {
    const n = sessionAttempts(cur.item.ch).length, box = $("prStars");
    box.textContent = "";
    for (let i = 0; i < pr.target; i++) {
      const s = document.createElement("span"); s.textContent = "★"; if (i < n) s.className = "on"; box.appendChild(s);
    }
    if (n > pr.target) { const s = document.createElement("em"); s.textContent = `+${n - pr.target}`; box.appendChild(s); }
    $("prPage").dataset.count = n;
  }
  function renderStrip() {
    const box = $("prAttempts"); box.textContent = "";
    const at = sessionAttempts(cur.item.ch);
    const lbl = document.createElement("span"); lbl.className = "lbl";
    lbl.textContent = at.length ? "这次写的：" : "写好一个，按“✓ 写好了”，就会存在这里。";
    box.appendChild(lbl);
    for (const a of at) box.appendChild(thumb(a, cur.glyph, 88));
  }
  function renderTitle() {
    const s = pr.session, it = cur.item, D = TZ.DIGITS[it.ch];
    $("prPy").textContent = TZ.isDigit(it.ch) ? `${D.han} ${D.py}` : (it.py || "");
    $("prPos").textContent = `第 ${s.idx + 1} 个，共 ${s.list.length} 个`;
    $("prPrev").disabled = s.idx === 0;
    $("prNext").textContent = s.idx === s.list.length - 1 ? "看作业 ▶" : "下一个 ▶";
  }
  function speakChar() {
    const ch = cur.item.ch;
    TZ.speak(TZ.isDigit(ch) ? `写数字，${TZ.DIGITS[ch].han}` : `写一写，${ch}`);
  }

  async function showChar() {
    const tok = (showTok = {});
    const s = pr.session, item = s.list[s.idx];
    const glyph = await glyphOf(item.ch);
    if (tok !== showTok) return;
    const draft = s.draft && s.draft.ch === item.ch ? s.draft.strokes : [];
    cur = { item, glyph, strokes: draft.slice(), cleared: null, S: 0 };
    $("prPage").dataset.ch = item.ch;
    buildStage(); renderModel(); renderStars(); renderStrip(); renderTitle();
    speakChar();
  }

  function cheer(text) {
    const c = $("prCheer");
    c.textContent = text;
    c.classList.remove("show"); void c.offsetWidth; c.classList.add("show");
  }

  async function done() {
    if (busy || !cur) return;
    if (!cur.strokes.length) {
      TZ.speak("先写一写吧");
      const st = $("prStage"); st.classList.remove("shake"); void st.offsetWidth; st.classList.add("shake");
      return;
    }
    addAttempt(cur.item.ch, cur.strokes);
    cur.strokes = []; cur.cleared = null;
    saveDraft(); redraw(); renderStars(); renderStrip();
    const n = sessionAttempts(cur.item.ch).length;
    if (n === pr.target) {
      busy = true;
      cheer("★ 这个字练好了 ★");
      TZ.speak("这个字练好了");
      await new Promise((r) => setTimeout(r, 1400));
      busy = false;
      if (!$("prPage").hidden) go(1);
    } else TZ.speak(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
  }

  function go(step) {
    if (busy) return;
    commitDraft();
    const s = pr.session, i = s.idx + step;
    if (i >= s.list.length) { showSummary(true); return; }
    if (i < 0) return;
    s.idx = i; savePr();
    showChar();
  }

  async function showSummary(finished) {
    commitDraft();
    if (cur) { renderStars(); renderStrip(); redraw(); }
    const s = pr.session, box = $("prSumList");
    const glyphs = await Promise.all(s.list.map((it) => glyphOf(it.ch)));
    box.textContent = "";
    let allDone = true;
    s.list.forEach((it, k) => {
      const at = sessionAttempts(it.ch);
      if (at.length < pr.target) allDone = false;
      const row = document.createElement("div"); row.className = "pr-sum-row"; row.dataset.ch = it.ch;
      const m = TZ.gridSvg(64, hooks.color(), row); drawGlyph(m, glyphs[k], 64, INK_COLOR);
      const py = document.createElement("span"); py.className = "py";
      py.textContent = TZ.isDigit(it.ch) ? TZ.DIGITS[it.ch].han : (it.py || "");
      row.appendChild(py);
      for (const a of at) row.appendChild(thumb(a, glyphs[k], 64));
      const cnt = document.createElement("span");
      cnt.className = "cnt" + (at.length >= pr.target ? " ok" : "");
      cnt.textContent = at.length ? `写了 ${at.length} 遍${at.length >= pr.target ? " ✓" : ""}` : "还没写";
      row.appendChild(cnt);
      row.addEventListener("click", () => { $("prSummary").hidden = true; s.idx = k; savePr(); showChar(); });
      box.appendChild(row);
    });
    $("prSumTitle").textContent = allDone ? "作业写完啦 ★" : "看看写了哪些";
    $("prSummary").hidden = false;
    $("prPage").dataset.summary = allDone ? "done" : "open";
    if (finished && allDone) { TZ.speak("作业写完了，真棒！"); cheer("★ 作业写完啦 ★"); }
  }

  async function open(list, startIdx) {
    if (!list || !list.length) return false;
    const key = list.map((x) => x.ch).join("");
    const s0 = pr.session;
    if (!(s0 && s0.key === key && Date.now() - s0.start < SESSION_TTL)) pr.session = { key, start: Date.now(), idx: 0, draft: null };
    const s = pr.session;
    s.list = list;
    if (startIdx != null && startIdx >= 0) s.idx = startIdx;
    s.idx = Math.max(0, Math.min(list.length - 1, s.idx || 0));
    if (s.draft && s.draft.ch !== list[s.idx].ch) { addAttempt(s.draft.ch, s.draft.strokes); s.draft = null; }
    savePr();
    busy = false;
    $("prPage").hidden = false; $("prSummary").hidden = true; $("prPage").dataset.summary = "";
    document.body.classList.add("pr-open");
    syncControls();
    await showChar();
    return true;
  }
  function close() {
    if ($("prPage").hidden) return;
    showTok = {};
    $("prPage").hidden = true;
    document.body.classList.remove("pr-open");
    window.speechSynthesis?.cancel();
  }

  function syncControls() {
    $("prTplSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === pr.template));
    $("prTarget").value = String(pr.target);
  }

  function init(h) {
    hooks = Object.assign(hooks, h);
    $("prBack").onclick = close;
    $("prSay").onclick = () => cur && speakChar();
    $("prHw").onclick = () => showSummary(false);
    $("prDone").onclick = done;
    $("prPrev").onclick = () => go(-1);
    $("prNext").onclick = () => go(1);
    $("prUndo").onclick = () => {
      if (!cur) return;
      if (cur.strokes.length) cur.strokes.pop();
      else if (cur.cleared) { cur.strokes = cur.cleared; cur.cleared = null; }   // 擦掉后还能撤销回来
      redraw(); saveDraft();
    };
    $("prClear").onclick = () => {
      if (!cur || !cur.strokes.length) return;
      cur.cleared = cur.strokes; cur.strokes = [];
      redraw(); saveDraft();
    };
    $("prTplSeg").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      pr.template = b.dataset.v; savePr(); syncControls();
      const tpl = $("prTplLayer"); if (tpl) tpl.style.display = pr.template === "trace" ? "" : "none";
    });
    $("prTarget").addEventListener("change", (e) => { pr.target = +e.target.value; savePr(); if (cur) renderStars(); });
    $("prHint").onclick = () => cur && TZ.StrokePage.open(cur.item.ch, { pinyin: cur.item.py });
    $("prSumAgain").onclick = () => {
      pr.session.start = Date.now(); pr.session.idx = 0; pr.session.draft = null; savePr();
      $("prSummary").hidden = true; $("prPage").dataset.summary = ""; showChar();
    };
    $("prSumClose").onclick = () => { $("prSummary").hidden = true; $("prPage").dataset.summary = ""; };
    $("prSumExit").onclick = () => { $("prSummary").hidden = true; close(); };
    $("prCheer").addEventListener("animationend", () => $("prCheer").classList.remove("show"));
    $("prStage").addEventListener("animationend", () => $("prStage").classList.remove("shake"));
    let rt; addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (cur && !$("prPage").hidden && stageSize() !== cur.S) buildStage(); }, 200);
    });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("prPage").hidden) close(); });
  }

  window.TZ.Practice = { init, open, close, state: () => ({ cur, pr, inkStore }) };
})();
