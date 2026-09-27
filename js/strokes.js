// 笔顺页：演示、逐笔、描一描、笔顺分解、语音
// 依赖：vendor/hanzi-writer.js；数据：data/digits.json、data/strokes/NN.json
(() => {
  const SVGNS = "http://www.w3.org/2000/svg";
  const SHARDS = 64;
  const CN = "零一二三四五六七八九十";
  const cnNum = (n) => n <= 10 ? CN[n] : n < 20 ? "十" + CN[n - 10] : CN[Math.floor(n / 10)] + "十" + (n % 10 ? CN[n % 10] : "");

  // ---------- 数据 ----------
  let DIGITS = {};
  const ready = fetch("data/digits.json").then((r) => r.json()).then((d) => { DIGITS = d; });
  const shardCache = {};
  async function loadStroke(ch) {
    await ready;
    if (DIGITS[ch]) return DIGITS[ch];
    const k = String(ch.codePointAt(0) % SHARDS).padStart(2, "0");
    if (!shardCache[k]) shardCache[k] = fetch(`data/strokes/${k}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch((e) => { delete shardCache[k]; throw e; });
    const d = (await shardCache[k])[ch];
    if (!d) throw new Error("没有这个字的笔顺数据");
    return d;
  }
  const isDigit = (ch) => /^[0-9]$/.test(ch);

  // 数据坐标（1024 框，y 向上，-124..900）→ 格子内坐标
  function dataTransform(x0, y0, size, pad) {
    const s = (size - 2 * pad) / 1024;
    return { s, attr: `matrix(${s},0,0,${-s},${x0 + pad},${y0 + pad + 900 * s})`,
             pt: ([x, y]) => [x0 + pad + x * s, y0 + pad + (900 - y) * s] };
  }

  function el(name, attrs, parent) {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function gridSvg(size, color, parent) {
    const svg = el("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, parent);
    const g = el("g", { stroke: color, fill: "none" }, svg);
    const w = Math.max(1.2, size / 160);
    el("path", { d: `M${size / 2} 0V${size}M0 ${size / 2}H${size}`, "stroke-width": w * .7, "stroke-dasharray": `${size / 40} ${size / 50}` }, g);
    el("rect", { x: w / 2, y: w / 2, width: size - w, height: size - w, "stroke-width": w * 1.4 }, g);
    return svg;
  }

  // ---------- 语音 ----------
  let voiceOn = localStorage.getItem("tz-voice") !== "0";
  let zhVoice = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices().filter((v) => /^zh[-_](CN|Hans)/i.test(v.lang) || v.lang === "zh-CN");
    zhVoice = vs.find((v) => /Tingting|婷婷|Xiaoxiao|晓晓/i.test(v.name)) || vs[0] || null;
  }
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    window.__spoken = (window.__spoken || []).concat(text);   // 供测试核对
    if (!voiceOn || !("speechSynthesis" in window) || !text) return Promise.resolve();
    speechSynthesis.cancel();
    return new Promise((res) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN"; u.rate = 0.8; u.pitch = 1.05;
      if (zhVoice) u.voice = zhVoice;
      const t = setTimeout(res, 800 + text.length * 350);
      u.onend = u.onerror = () => { clearTimeout(t); res(); };
      speechSynthesis.speak(u);
    });
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 页面 ----------
  const $ = (id) => document.getElementById(id);
  let ctx = null;        // { ch, data, writer, cur, n, token, mode }
  let hooks = { color: () => "#3a9a5b", pinyin: () => "", fixPinyin: null };

  function strokeLabel(i) {
    const d = ctx.data;
    if (isDigit(ctx.ch)) return d.say[i] || d.how;
    const name = d.n[i];
    return `第${cnNum(i + 1)}笔，${name || ""}`.replace(/，$/, "");
  }

  function layout() {
    const vw = innerWidth, vh = innerHeight;
    const land = vw > vh;
    const S = Math.floor(land ? Math.min(vh - 220, vw * 0.55, 620) : Math.min(vw - 48, vh * 0.48, 620));
    return Math.max(220, S);
  }

  function buildStage() {
    const S = layout(), pad = Math.round(S * 0.08);
    const stage = $("spStage");
    stage.textContent = "";
    stage.style.width = stage.style.height = S + "px";
    gridSvg(S, hooks.color(), stage).classList.add("sp-grid");
    const wdiv = document.createElement("div"); wdiv.id = "spWriter"; stage.appendChild(wdiv);
    const ov = el("svg", { id: "spOverlay", width: S, height: S, viewBox: `0 0 ${S} ${S}` }, stage);
    const ch = ctx.ch;
    ctx.S = S; ctx.pad = pad;
    ctx.writer = HanziWriter.create(wdiv, ch, {
      width: S, height: S, padding: pad,
      showOutline: true, showCharacter: false,
      strokeColor: "#1d1d1f", outlineColor: "#dcdcdc", highlightColor: "#f08c00",
      drawingColor: "#2f7d4a", drawingWidth: Math.max(12, S * 0.04), drawingFadeDuration: 400,
      strokeAnimationSpeed: 0.55, delayBetweenStrokes: 400, strokeFadeDuration: 300,
      showHintAfterMisses: 2, leniency: 1.5, highlightOnComplete: true,
      charDataLoader: (c, onLoad, onErr) => loadStroke(c).then((d) => onLoad({ strokes: d.s, medians: d.m })).catch(onErr),
    });
    return ov;
  }

  // 起笔点（绿点 + 序号）和行笔方向箭头
  function showStart(i) {
    const ov = $("spOverlay"); if (!ov) return;
    ov.textContent = "";
    ov.classList.remove("faded");
    if (i == null || i >= ctx.n) return;
    const T = dataTransform(0, 0, ctx.S, ctx.pad);
    const m = ctx.data.m[i].map(T.pt);
    const r = Math.max(13, ctx.S * 0.035);
    // 箭头：沿中线前进约 18% 字宽
    let acc = 0, k = 1;
    while (k < m.length - 1 && acc < ctx.S * 0.16) { acc += Math.hypot(m[k][0] - m[k - 1][0], m[k][1] - m[k - 1][1]); k++; }
    const pts = m.slice(0, k + 1);
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const g = el("g", { class: "sp-start" }, ov);
    el("polyline", { points: pts.map((p) => p.join(",")).join(" "), fill: "none", stroke: "#2f9e44", "stroke-width": r * 0.35,
                     "stroke-linecap": "round", "stroke-linejoin": "round", opacity: .75 }, g);
    const h = r * 0.9;
    el("path", { d: `M${b[0]} ${b[1]} L${b[0] - h * Math.cos(ang - 0.5)} ${b[1] - h * Math.sin(ang - 0.5)} L${b[0] - h * Math.cos(ang + 0.5)} ${b[1] - h * Math.sin(ang + 0.5)} Z`,
                 fill: "#2f9e44", opacity: .85 }, g);
    el("circle", { cx: m[0][0], cy: m[0][1], r, fill: "#2f9e44" }, g);
    const t = el("text", { x: m[0][0], y: m[0][1] + r * 0.36, "font-size": r * 1.05, "text-anchor": "middle", fill: "#fff",
                           "font-weight": 700, "font-family": "-apple-system, sans-serif" }, g);
    t.textContent = i + 1;
  }

  function renderSteps() {
    const box = $("spSteps"); box.textContent = "";
    const size = Math.max(54, Math.min(76, Math.floor((innerWidth - 60) / Math.min(ctx.n, 10)) - 10));
    for (let k = 0; k < ctx.n; k++) {
      const item = document.createElement("button");
      item.className = "sp-step" + (k === ctx.cur ? " cur" : "") + (k < ctx.cur ? " done" : "");
      item.dataset.k = k;
      const svg = gridSvg(size, hooks.color(), item);
      const T = dataTransform(0, 0, size, size * 0.08);
      const g = el("g", { transform: T.attr }, svg);
      for (let j = 0; j <= k; j++) el("path", { d: ctx.data.s[j], fill: j === k ? "#e03131" : "#333" }, g);
      const cap = document.createElement("span");
      const nm = isDigit(ctx.ch) ? (ctx.data.n[k] === "一笔写成" ? "一笔写成" : ctx.data.n[k]) : (ctx.data.n[k] || "");
      cap.textContent = `${k + 1}${nm ? " " + nm : ""}`;
      item.appendChild(cap);
      box.appendChild(item);
    }
  }
  function setCur(k) {
    ctx.cur = k;
    document.querySelectorAll("#spSteps .sp-step").forEach((b) => {
      const i = +b.dataset.k; b.classList.toggle("cur", i === k); b.classList.toggle("done", i < k);
    });
    $("spNext").textContent = k >= ctx.n ? "再来一遍" : k === 0 ? "第一笔" : "下一笔";
  }
  function say(text) { $("spSay").textContent = text; }
  function setMode(m) {
    ctx.mode = m;
    $("spPage").dataset.mode = m;
    ["spPlay", "spNext", "spTrace"].forEach((id) => $(id).classList.remove("on"));
    if (m === "play") $("spPlay").classList.add("on");
    if (m === "step") $("spNext").classList.add("on");
    if (m === "trace") $("spTrace").classList.add("on");
  }

  // 每次新动作都换 token，旧的循环自己停下
  function newToken() { ctx.token = {}; return ctx.token; }
  async function resetDrawing() {
    newToken();
    speechSynthesis?.cancel?.();
    try { ctx.writer.cancelQuiz(); } catch { }
    await ctx.writer.hideCharacter({ duration: 0 });
    showStart(null); setCur(0);
  }

  async function animateTo(i, tok) {
    showStart(i);
    const line = strokeLabel(i);
    say(line);
    await Promise.all([speak(line), new Promise((r) => ctx.writer.animateStroke(i, { onComplete: r }))]);
    if (tok !== ctx.token) return false;
    $("spOverlay")?.classList.add("faded");     // 写完这一笔，起笔点变淡，不挡笔画
    setCur(i + 1);
    return true;
  }

  async function play() {
    await resetDrawing(); setMode("play");
    const tok = ctx.token;
    for (let i = 0; i < ctx.n; i++) {
      if (!(await animateTo(i, tok))) return;
      await wait(350);
      if (tok !== ctx.token) return;
    }
    showStart(null);
    say(isDigit(ctx.ch) ? ctx.data.rhyme : `写完了，一共${cnNum(ctx.n)}笔。`);
    speak(isDigit(ctx.ch) ? ctx.data.rhyme : `写完了，一共${cnNum(ctx.n)}笔`);
    $("spPage").dataset.done = "play";
  }

  async function next() {
    if (ctx.mode !== "step" || ctx.busy) { if (ctx.mode !== "step") { await resetDrawing(); setMode("step"); } }
    if (ctx.busy) return;
    if (ctx.cur >= ctx.n) { await resetDrawing(); setMode("step"); }
    ctx.busy = true;
    const tok = ctx.token;
    await animateTo(ctx.cur, tok);
    ctx.busy = false;
    if (ctx.cur >= ctx.n) { showStart(null); say("写完了！"); speak("写完了"); }
  }

  // 点分解图第 k 格：快速画出前 k 笔，再慢慢演示第 k 笔
  async function jump(k) {
    await resetDrawing(); setMode("step");
    const tok = ctx.token;
    const w = ctx.writer, speed = w._options.strokeAnimationSpeed;
    w._options.strokeAnimationSpeed = 50;
    for (let j = 0; j < k; j++) await new Promise((r) => w.animateStroke(j, { onComplete: r }));
    w._options.strokeAnimationSpeed = speed;
    if (tok !== ctx.token) return;
    setCur(k);
    ctx.busy = true; await animateTo(k, tok); ctx.busy = false;
  }

  async function trace() {
    await resetDrawing(); setMode("trace");
    const tok = ctx.token;
    showStart(0);
    const first = strokeLabel(0);
    say("用手指描一描。" + first); speak("用手指描一描。" + first);
    ctx.writer.quiz({
      onCorrectStroke: (d) => {
        if (tok !== ctx.token) return;
        const n = d.strokeNum + 1;
        setCur(n);
        if (n < ctx.n) { showStart(n); const l = strokeLabel(n); say(l); speak(l); } else showStart(null);
      },
      onMistake: (d) => {
        if (tok !== ctx.token) return;
        if (d.mistakesOnStroke === 1) { say("从绿点开始，跟着箭头写。"); speak("从绿点开始，跟着箭头写"); }
        if (d.mistakesOnStroke === 2) { say("看，这一笔要这样写。"); speak("看，这一笔要这样写"); }
      },
      onComplete: (d) => {
        if (tok !== ctx.token) return;
        const good = d.totalMistakes <= Math.max(1, Math.floor(ctx.n / 3));
        say(good ? "写得真棒！" : "写完了，再练一遍会更好！");
        speak(good ? "写得真棒" : "写完了，再练一遍会更好");
        celebrate(good);
        $("spPage").dataset.done = "trace";
      },
    });
  }

  function clearCheer() { $("spCheer").classList.remove("show"); }
  function celebrate(good) {
    const c = $("spCheer");
    c.textContent = good ? "★ 真棒 ★" : "写完啦";
    c.classList.remove("show"); void c.offsetWidth; c.classList.add("show");
  }

  async function open(ch, opts = {}) {
    let data;
    try { data = await loadStroke(ch); }
    catch (e) { alert(`“${ch}”的笔顺数据加载失败，请联网后再试一次。`); return; }
    ctx = { ch, data, n: data.s.length, cur: 0, token: {}, mode: "", busy: false, opts };
    const page = $("spPage");
    page.hidden = false; page.dataset.done = ""; page.dataset.kind = isDigit(ch) ? "digit" : "han";
    document.body.classList.add("sp-open");
    clearCheer();
    $("spChar").textContent = ch;
    const py = isDigit(ch) ? `${data.han} ${data.py}` : (opts.pinyin || "");
    $("spPy").textContent = py;
    $("spCount").textContent = `共 ${ctx.n} 笔`;
    $("spRhyme").textContent = isDigit(ch) ? data.rhyme : "";
    $("spFix").hidden = !(opts.onFixPinyin);
    $("spVoice").classList.toggle("off", !voiceOn);
    buildStage();
    renderSteps();
    setCur(0); setMode("");
    say(isDigit(ch) ? data.how : "点“看一看”，或者一笔一笔地学。");
    speak(isDigit(ch) ? data.rhyme : ch);
  }

  function close() {
    if (!ctx) return;
    newToken();
    try { ctx.writer.cancelQuiz(); } catch { }
    speechSynthesis?.cancel?.();
    $("spPage").hidden = true;
    document.body.classList.remove("sp-open");
    ctx = null;
  }

  function init(h) {
    hooks = Object.assign(hooks, h);
    $("spBack").onclick = close;
    $("spCheer").addEventListener("animationend", clearCheer);
    $("spPlay").onclick = play;
    $("spNext").onclick = next;
    $("spTrace").onclick = trace;
    $("spSteps").addEventListener("click", (e) => { const b = e.target.closest(".sp-step"); if (b) jump(+b.dataset.k); });
    $("spVoice").onclick = () => {
      voiceOn = !voiceOn; localStorage.setItem("tz-voice", voiceOn ? "1" : "0");
      $("spVoice").classList.toggle("off", !voiceOn);
      if (!voiceOn) speechSynthesis?.cancel?.(); else speak("声音打开了");
    };
    $("spFix").onclick = (e) => ctx?.opts.onFixPinyin?.(e.currentTarget, (py) => { $("spPy").textContent = py; });
    let rt; addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(async () => {
        if (!ctx || layout() === ctx.S) return;       // 尺寸没变就不打断演示
        newToken(); buildStage(); renderSteps(); setCur(0); setMode(""); showStart(null);
      }, 200);
    });
    addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  window.TZ = { ready, loadStroke, isDigit, dataTransform, get DIGITS() { return DIGITS; }, StrokePage: { init, open, close, state: () => ctx } };
})();
