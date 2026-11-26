/* GoldPath Slide Sendout — phone app (PWA).
   All send-outs are stored on this device (localStorage). Nothing is sent to a server. */
(() => {
  "use strict";

  const KEY = "gp-sendouts-v1";
  const DOCTORS = ["Dr. Milyani", "Dr. Burg", "Dr. Tarasen", "Dr. Mubasher"];
  const METHODS = ["Courier", "FedEx", "UPS", "USPS", "Hand Delivered", "Other"];
  const CASE_RE = /^([A-Z]{1,4}\d{2}-\d+)/;
  const SLIDE_RE = /^[A-Z]{1,4}\d{2}-\d+-[A-Z]+-\d+-\d+$/;
  const PART_RE = /^[A-Z]{1,4}\d{2}-\d+-[A-Z]+(-\d+)?$/; // specimen or block label, not a slide

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------------------------------------------------------------- storage
  let data = [];
  function load() {
    try { data = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { data = []; }
    if (!Array.isArray(data)) data = [];
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { toast("Could not save on this phone: " + e.message, "warn"); }
  }
  const uid = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4);
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  // ---------------------------------------------------------------- formatting
  const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}/${y}`; };
  const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
  const caseOf = (bc) => (bc.match(CASE_RE) || [])[1] || null;
  const isCtrl = (bc) => !caseOf(bc);
  const countCases = (slides) => new Set(slides.map((s) => caseOf(s.barcode)).filter(Boolean)).size;

  // ---------------------------------------------------------------- feedback
  let toastTimer;
  function toast(msg, kind = "") {
    const t = $("#toast");
    t.textContent = msg; t.className = "toast " + kind; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), kind === "warn" ? 3200 : 1800);
  }
  let audio;
  function beep(ok = true) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "square"; o.frequency.value = ok ? 1760 : 220;
      g.gain.value = 0.06; o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.35));
    } catch { /* no audio */ }
    try { navigator.vibrate && navigator.vibrate(ok ? 60 : [120, 80, 120]); } catch { /* */ }
  }

  // ---------------------------------------------------------------- routing
  let current = null; // the send-out being edited
  function show(screen) {
    $("#screen-list").hidden = screen !== "list";
    $("#screen-edit").hidden = screen !== "edit";
    window.scrollTo(0, 0);
  }
  function route() {
    const m = location.hash.match(/^#\/s\/(\w+)/);
    stopCamera();
    if (m) {
      current = data.find((s) => s.id === m[1]);
      if (current) { renderEdit(); show("edit"); focusScan(); return; }
    }
    current = null;
    renderList(); show("list");
  }
  window.addEventListener("hashchange", route);

  // ---------------------------------------------------------------- list screen
  function renderList() {
    const list = $("#sendout-list");
    const sorted = [...data].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.created || 0) - (a.created || 0));
    if (!sorted.length) {
      list.innerHTML = `<div class="empty">No send-outs yet.<br>Tap <b>New send-out</b> to start scanning.</div>`;
      return;
    }
    list.innerHTML = sorted.map((s) => `
      <button class="so-item" data-id="${s.id}">
        <span class="so-date">${esc(fmtDate(s.date))}</span>
        <span class="so-doc">${esc(s.doctor || "—")}${s.shipping?.method ? `<span class="muted small">${esc(s.shipping.method === "Other" ? s.shipping.methodOther || "Other" : s.shipping.method)}${s.shipping.sentBy ? " · " + esc(s.shipping.sentBy) : ""}</span>` : ""}</span>
        <span class="so-count">${s.slides.length}</span>
      </button>`).join("");
  }
  $("#sendout-list").addEventListener("click", (e) => {
    const b = e.target.closest(".so-item"); if (b) location.hash = "#/s/" + b.dataset.id;
  });
  $("#btn-new").addEventListener("click", () => {
    const s = { id: uid(), date: todayISO(), doctor: "", notes: "", shipping: {}, slides: [], created: Date.now() };
    data.push(s); save();
    location.hash = "#/s/" + s.id;
    setTimeout(() => $("#f-doctor").focus(), 50);
  });

  // menu
  $("#btn-menu").addEventListener("click", (e) => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; });
  document.addEventListener("click", () => ($("#menu").hidden = true));
  $("#menu").addEventListener("click", (e) => {
    const act = e.target.dataset.act; if (!act) return;
    if (act === "export-csv") exportCSV();
    if (act === "backup") download(`sendout-backup-${todayISO()}.json`, JSON.stringify({ app: "gp-sendout", version: 1, sendouts: data }, null, 1), "application/json");
    if (act === "restore") $("#restore-file").click();
  });
  $("#restore-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const incoming = Array.isArray(j) ? j : j.sendouts;
      if (!Array.isArray(incoming)) throw new Error("not a backup file");
      let added = 0;
      for (const s of incoming) if (s && s.id && Array.isArray(s.slides) && !data.some((d) => d.id === s.id)) { data.push(s); added++; }
      save(); renderList(); toast(`Restored ${added} send-out(s)`, "ok");
    } catch (err) { toast("Restore failed: " + err.message, "warn"); }
    e.target.value = "";
  });

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function exportCSV() {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["SendDate", "Doctor", "Notes", "SentBy", "Method", "Tracking", "ScanTime", "Barcode"]];
    for (const s of [...data].sort((a, b) => (a.date || "").localeCompare(b.date || ""))) {
      const sh = s.shipping || {};
      const method = sh.method === "Other" ? sh.methodOther || "Other" : sh.method || "";
      for (const sl of s.slides) rows.push([fmtDate(s.date), s.doctor, s.notes, sh.sentBy, method, sh.tracking, fmtTime(sl.time), sl.barcode]);
    }
    download(`slide-sendouts-${todayISO()}.csv`, "﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n"), "text/csv");
  }

  // ---------------------------------------------------------------- edit screen
  function doctorOptions() {
    const all = new Set(DOCTORS);
    data.forEach((s) => s.doctor && all.add(s.doctor));
    $("#doctors").innerHTML = [...all].map((d) => `<option value="${esc(d)}">`).join("");
  }
  function renderEdit() {
    const s = current, sh = s.shipping || (s.shipping = {});
    doctorOptions();
    $("#f-date").value = s.date || "";
    $("#f-doctor").value = s.doctor || "";
    $("#f-notes").value = s.notes || "";
    $("#f-sentby").value = sh.sentBy || "";
    $("#f-method").value = sh.method || "";
    $("#f-method-other").value = sh.methodOther || "";
    $("#other-wrap").hidden = sh.method !== "Other";
    $("#f-tracking").value = sh.tracking || "";
    $("#f-senttime").value = sh.sentTime || "";
    renderSlides();
    updateTitle();
  }
  function updateTitle() {
    $("#edit-title").textContent = `${fmtDate(current.date)} · ${current.doctor || "New send-out"}`;
  }
  function renderSlides(flashIdx = -1) {
    const sl = current.slides;
    $("#count").textContent = sl.length;
    const nc = countCases(sl);
    $("#cases").textContent = nc ? `${nc} case${nc === 1 ? "" : "s"}` : "";
    // newest at top so the latest scan is always visible; gold line between cases
    const rows = sl.map((x, i) => ({ x, i, c: caseOf(x.barcode) })).reverse();
    $("#slide-list").innerHTML = rows.map(({ x, i, c }, k) => {
      const cls = [i === flashIdx ? "flash" : "", k > 0 && rows[k - 1].c !== c ? "case-break" : ""].join(" ");
      return `<li data-i="${i}" class="${cls}">
        <span class="n">${i + 1}</span>
        <span class="bc ${c ? "" : "ctrl"}">${esc(x.barcode)}</span>
        <span class="t">${esc(fmtTime(x.time))}</span>
        <button class="del" aria-label="Remove">✕</button></li>`;
    }).join("");
  }

  function bind(id, fn) { $(id).addEventListener("input", (e) => { fn(e.target.value); current.updated = Date.now(); save(); }); }
  bind("#f-date", (v) => { current.date = v; updateTitle(); });
  bind("#f-doctor", (v) => { current.doctor = v.trim(); updateTitle(); });
  bind("#f-notes", (v) => (current.notes = v));
  bind("#f-sentby", (v) => (current.shipping.sentBy = v));
  bind("#f-method-other", (v) => (current.shipping.methodOther = v));
  bind("#f-tracking", (v) => (current.shipping.tracking = v));
  bind("#f-senttime", (v) => (current.shipping.sentTime = v));
  $("#f-method").addEventListener("change", (e) => {
    current.shipping.method = e.target.value; $("#other-wrap").hidden = e.target.value !== "Other"; save();
  });
  // pressing Enter in a header field jumps to scanning
  ["#f-doctor", "#f-notes"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); focusScan(); } }));

  $("#btn-back").addEventListener("click", () => { location.hash = ""; });
  $("#btn-delete").addEventListener("click", () => {
    if (!confirm(`Delete the ${fmtDate(current.date)} send-out to ${current.doctor || "—"} (${current.slides.length} slides)? This cannot be undone.`)) return;
    data = data.filter((s) => s !== current); save(); location.hash = "";
  });
  $("#slide-list").addEventListener("click", (e) => {
    const b = e.target.closest(".del"); if (!b) return;
    const i = +b.closest("li").dataset.i;
    const bc = current.slides[i].barcode;
    if (!confirm(`Remove ${bc}?`)) return;
    current.slides.splice(i, 1); save(); renderSlides();
  });

  // ---------------------------------------------------------------- adding slides
  function addBarcode(raw, source) {
    let bc = String(raw || "").replace(/[\u0000-\u001F]/g, "").trim();
    if (!bc) return false;
    if (/^[a-z]{1,4}\d{2}-/i.test(bc)) bc = bc.toUpperCase();
    if (current.slides.some((s) => s.barcode === bc)) {
      beep(false); toast(`Already scanned: ${bc}`, "warn"); return false;
    }
    if (PART_RE.test(bc)) {
      beep(false); toast(`${bc} is a specimen/block label, not a slide`, "warn"); return false;
    }
    current.slides.push({ barcode: bc, time: new Date().toISOString(), src: source });
    current.updated = Date.now(); save();
    renderSlides(current.slides.length - 1);
    beep(true);
    if (!SLIDE_RE.test(bc) && caseOf(bc)) toast(`Added (unusual format): ${bc}`);
    return true;
  }

  // hardware (Bluetooth / USB) scanners type the code and press Enter (or Tab)
  const scanInput = $("#scan-input");
  function focusScan() { if (!current) return; scanInput.focus({ preventScroll: true }); }
  $("#scan-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (addBarcode(scanInput.value, "input")) scanInput.value = "";
    else scanInput.select();
  });
  scanInput.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && scanInput.value.trim()) { e.preventDefault(); $("#scan-form").requestSubmit(); }
  });
  $("#btn-keyboard").addEventListener("click", () => {
    const typing = scanInput.getAttribute("inputmode") === "none";
    scanInput.setAttribute("inputmode", typing ? "text" : "none");
    $("#btn-keyboard").classList.toggle("primary", typing);
    scanInput.blur(); setTimeout(focusScan, 30);
  });

  document.querySelectorAll("[data-ctrl]").forEach((b) => b.addEventListener("click", () => {
    const sign = b.dataset.ctrl;
    const d = new Date();
    const def = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
    const label = prompt(`${sign === "+" ? "Positive" : "Negative"} control — label (date / initials):`, def);
    if (label === null) return;
    addBarcode(`Ctrl ${sign} ${label}`.trim(), "ctrl");
  }));

  // ---------------------------------------------------------------- camera scanning
  // Slide labels carry a tiny DataMatrix (a few mm). Two decoders are used:
  //  - Chrome's built-in BarcodeDetector (fast, when available)
  //  - ZXing-C++ compiled to WebAssembly (vendor/), much better on small/low-contrast DataMatrix
  // Both run on a cropped, enlarged copy of the yellow square, not the whole frame.
  let stream = null, detector = null, scanning = false, lastCode = "", lastAt = 0;
  let zx = null, zxLoading = null, frames = 0, lastErr = "";
  const ZX_FORMATS = ["DataMatrix", "QRCode", "MicroQRCode", "Code128", "Code39", "Code93", "Aztec", "PDF417"];
  const ZX_BASE = { formats: ZX_FORMATS, tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, tryDenoise: true, maxNumberOfSymbols: 1, returnErrors: true };
  const roiCanvas = document.createElement("canvas");
  const roiCtx = roiCanvas.getContext("2d", { willReadFrequently: true });
  const bgCanvas = document.createElement("canvas");
  const bgCtx = bgCanvas.getContext("2d", { willReadFrequently: true });
  const smallCanvas = document.createElement("canvas");
  const smallCtx = smallCanvas.getContext("2d");

  function loadZXing() {
    if (zx) return Promise.resolve(zx);
    if (zxLoading) return zxLoading;
    zxLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/zxing-reader.js";
      s.onload = () => {
        try {
          ZXingWASM.setZXingModuleOverrides({ locateFile: (p, prefix) => (p.endsWith(".wasm") ? new URL("vendor/zxing_reader.wasm", location.href).href : prefix + p) });
          ZXingWASM.prepareZXingModule({ fireImmediately: true }).then(() => resolve((zx = ZXingWASM))).catch(reject);
        } catch (e) { reject(e); }
      };
      s.onerror = () => reject(new Error("could not load ZXing"));
      document.head.appendChild(s);
    }).catch((e) => { zxLoading = null; lastErr = e.message; return null; });
    return zxLoading;
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { toast("This browser can't use the camera. Use Chrome on Android.", "warn"); return; }
    loadZXing(); // start fetching the decoder while the camera opens
    try {
      if ("BarcodeDetector" in window) {
        const fmts = await BarcodeDetector.getSupportedFormats();
        const want = ["data_matrix", "qr_code", "code_128", "code_39", "code_93", "aztec", "pdf417"].filter((f) => fmts.includes(f));
        detector = want.length ? new BarcodeDetector({ formats: want }) : null;
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      });
    } catch (e) {
      toast("Couldn't open the camera: " + (e.message || e.name), "warn");
      return;
    }
    const video = $("#video");
    video.srcObject = stream;
    await video.play().catch(() => {});
    $("#camera-wrap").hidden = false;
    $("#cam-extra").hidden = false;
    $("#btn-camera").hidden = true;
    $("#btn-save-photo").hidden = true;

    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const adv = {};
    if (caps.focusMode && caps.focusMode.includes("continuous")) adv.focusMode = "continuous";
    if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] }).catch(() => {});
    $("#btn-torch").hidden = !caps.torch;
    // Phones can't focus closer than ~10 cm, where a slide label is tiny: zoom in and hold the phone back.
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const z = $("#zoom");
      z.min = caps.zoom.min; z.max = Math.min(caps.zoom.max, 8); z.step = caps.zoom.step || 0.1;
      let saved = NaN; try { saved = parseFloat(localStorage.getItem("gp-zoom")); } catch { /* */ }
      z.value = Math.min(+z.max, Math.max(+z.min, isNaN(saved) ? 2.5 : saved));
      setZoom(+z.value);
      $("#zoom-wrap").hidden = false;
    } else {
      $("#zoom-wrap").hidden = true;
    }

    scanning = true; frames = 0;
    scanLoop();
  }
  function setZoom(v) {
    const t = stream && stream.getVideoTracks()[0]; if (!t) return;
    t.applyConstraints({ advanced: [{ zoom: v }] }).catch(() => {});
    $("#zoom-val").textContent = (+v).toFixed(1) + "×";
    try { localStorage.setItem("gp-zoom", v); } catch { /* */ }
  }
  $("#zoom").addEventListener("input", (e) => setZoom(+e.target.value));

  // Copy the part of the video under the yellow square (times `margin`) to a canvas, enlarged.
  function grabROI(video, margin) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const box = video.getBoundingClientRect(), ret = document.querySelector(".reticle").getBoundingClientRect();
    const scale = Math.max(box.width / vw, box.height / vh);          // object-fit: cover
    const offX = (vw * scale - box.width) / 2, offY = (vh * scale - box.height) / 2;
    const cx = (ret.left + ret.width / 2 - box.left + offX) / scale;
    const cy = (ret.top + ret.height / 2 - box.top + offY) / scale;
    const side = Math.min(vw, vh, (ret.width / scale) * margin);
    const sx = Math.max(0, Math.min(vw - side, cx - side / 2)), sy = Math.max(0, Math.min(vh - side, cy - side / 2));
    const out = Math.max(640, Math.min(1280, Math.round(side * 1.5))); // enlarge small crops
    roiCanvas.width = roiCanvas.height = out;
    roiCtx.imageSmoothingEnabled = true;
    roiCtx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
    return { canvas: roiCanvas, w: vw, h: vh, side: Math.round(side) };
  }

  // ---- image clean-up recipes (each returns a new grey ImageData) ----
  const luma = (d, i) => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  // stretch the 1st..99th percentile of v[] (range -256..255) to 0..255
  function stretchInto(v, out) {
    const hist = new Uint32Array(512);
    for (let i = 0; i < v.length; i++) hist[v[i] + 256]++;
    const n = v.length, loT = n * 0.01, hiT = n * 0.99;
    let acc = 0, lo = 0, hi = 511;
    for (let k = 0; k < 512; k++) { acc += hist[k]; if (acc >= loT) { lo = k; break; } }
    acc = 0;
    for (let k = 0; k < 512; k++) { acc += hist[k]; if (acc >= hiT) { hi = k; break; } }
    const span = Math.max(1, hi - lo), d = out.data;
    for (let i = 0, j = 0; i < v.length; i++, j += 4) {
      let g = ((v[i] + 256 - lo) * 255) / span;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      d[j] = d[j + 1] = d[j + 2] = g; d[j + 3] = 255;
    }
    return out;
  }
  // plain contrast stretch: faint / washed-out printing
  function vStretch(img) {
    const s = img.data, v = new Int16Array(img.width * img.height);
    for (let i = 0, j = 0; i < v.length; i++, j += 4) v[i] = luma(s, j);
    return stretchInto(v, new ImageData(img.width, img.height));
  }
  // subtract a heavily blurred copy: removes glare / shadow gradients across the label
  function vFlatten(canvas, img) {
    const w = canvas.width, h = canvas.height;
    smallCanvas.width = Math.max(8, Math.round(w / 20)); smallCanvas.height = Math.max(8, Math.round(h / 20));
    smallCtx.imageSmoothingEnabled = true; smallCtx.imageSmoothingQuality = "high";
    smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
    bgCanvas.width = w; bgCanvas.height = h;
    bgCtx.imageSmoothingEnabled = true; bgCtx.imageSmoothingQuality = "high";
    bgCtx.drawImage(smallCanvas, 0, 0, w, h);
    const b = bgCtx.getImageData(0, 0, w, h).data, s = img.data, v = new Int16Array(w * h);
    for (let i = 0, j = 0; i < v.length; i++, j += 4) v[i] = luma(s, j) - luma(b, j);
    return stretchInto(v, new ImageData(w, h));
  }
  // unsharp mask: slightly soft focus
  function vSharpen(img) {
    const w = img.width, h = img.height, s = img.data, g = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = luma(s, j);
    const v = new Int16Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { v[i] = g[i]; continue; }
      const val = 5 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      v[i] = val < -255 ? -255 : val > 255 ? 255 : val;
    }
    return stretchInto(v, new ImageData(w, h));
  }

  // stronger unsharp mask at roughly module scale: out-of-focus labels (r = blur radius in px)
  function vDeblur(canvas, img, r, amount) {
    const w = canvas.width, h = canvas.height;
    bgCanvas.width = w; bgCanvas.height = h;
    bgCtx.filter = `blur(${r}px)`; bgCtx.drawImage(canvas, 0, 0); bgCtx.filter = "none";
    const b = bgCtx.getImageData(0, 0, w, h).data, s = img.data, v = new Int16Array(w * h);
    for (let i = 0, j = 0; i < v.length; i++, j += 4) {
      const g = luma(s, j), val = g + amount * (g - luma(b, j));
      v[i] = val < -256 ? -256 : val > 255 ? 255 : val;
    }
    return stretchInto(v, new ImageData(w, h));
  }

  let lastSeen = ""; // e.g. "DataMatrix seen but not readable (ChecksumError)"
  async function zxRead(img, binarizer) {
    const r = await zx.readBarcodes(img, { ...ZX_BASE, binarizer });
    const ok = r.find((x) => x.isValid && x.text);
    if (ok) return ok.text;
    const bad = r.find((x) => x.format && x.format !== "None");
    if (bad) lastSeen = `${bad.format} seen but not readable${bad.error ? " (" + String(bad.error).split(/[\s:]/)[0] + ")" : ""}`;
    return null;
  }

  // passes = list of [recipe, binarizer]; recipe: raw | stretch | flatten | sharpen
  async function decodeCanvas(canvas, useNative, passes) {
    if (useNative && detector) {
      try {
        const r = await detector.detect(canvas);
        if (r.length && r[0].rawValue) return { text: r[0].rawValue, by: "chrome" };
      } catch (e) { lastErr = "chrome: " + e.message; }
    }
    if (!zx) return null;
    try {
      const raw = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
      const cache = { raw };
      const make = (v) => {
        if (v === "stretch") return vStretch(raw);
        if (v === "flatten") return vFlatten(canvas, raw);
        if (v === "sharpen") return vSharpen(raw);
        const m = /^deblur(\d+)$/.exec(v); // deblurN: radius = canvas width / N
        return vDeblur(canvas, raw, Math.max(2, canvas.width / +m[1]), 2.5);
      };
      const get = (v) => cache[v] || (cache[v] = make(v));
      for (const [v, bin] of passes) {
        const t = await zxRead(get(v), bin);
        if (t) return { text: t, by: "zxing" + (v === "raw" ? "" : "-" + v) };
      }
    } catch (e) { lastErr = "zxing: " + e.message; }
    return null;
  }

  function onDecoded(val, by) {
    val = (val || "").trim();
    const now = Date.now();
    if (!val || (val === lastCode && now - lastAt < 2500)) return;
    lastCode = val; lastAt = now;
    if (addBarcode(val, "camera-" + by)) {
      const r = document.querySelector(".reticle"); r.classList.add("hit");
      setTimeout(() => r.classList.remove("hit"), 350);
      $("#btn-save-photo").hidden = true;
    }
  }

  // Each video frame tries one recipe; the cycle covers glare, faint print, soft focus and framing.
  const LIVE_PASSES = [
    { margin: 1.25, native: true,  passes: [["raw", "LocalAverage"]] },
    { margin: 1.25, native: false, passes: [["flatten", "LocalAverage"]] },
    { margin: 0.9,  native: true,  passes: [["raw", "GlobalHistogram"]] },
    { margin: 1.25, native: false, passes: [["stretch", "GlobalHistogram"]] },
    { margin: 0.9,  native: false, passes: [["flatten", "GlobalHistogram"]] },
    { margin: 1.6,  native: true,  passes: [["sharpen", "LocalAverage"]] },
    { margin: 1.25, native: false, passes: [["deblur100", "LocalAverage"]] },
    { margin: 0.9,  native: false, passes: [["deblur60", "GlobalHistogram"]] },
  ];
  async function scanLoop() {
    const video = $("#video");
    while (scanning) {
      if (video.readyState >= 2) {
        const p = LIVE_PASSES[frames % LIVE_PASSES.length];
        const roi = grabROI(video, p.margin);
        if (roi) {
          frames++;
          const hit = await decodeCanvas(roi.canvas, p.native, p.passes);
          if (hit) { onDecoded(hit.text, hit.by); lastSeen = ""; }
          if (frames % 12 === 1) {
            $("#cam-diag").textContent = `${roi.w}×${roi.h} · crop ${roi.side}px · ${detector ? "chrome+" : ""}${zx ? "zxing" : "zxing loading…"}${lastSeen ? " · " + lastSeen : ""}${lastErr ? " · " + lastErr : ""}`;
            lastSeen = "";
          }
        }
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  // Full-resolution still photo: far more pixels on the label than the video stream,
  // and every clean-up recipe is tried on several crop sizes.
  const PHOTO_PASSES = [
    ["raw", "LocalAverage"], ["flatten", "LocalAverage"], ["raw", "GlobalHistogram"],
    ["stretch", "GlobalHistogram"], ["flatten", "GlobalHistogram"], ["sharpen", "LocalAverage"],
    ["stretch", "LocalAverage"], ["sharpen", "GlobalHistogram"],
    ["deblur120", "LocalAverage"], ["deblur120", "GlobalHistogram"], ["deblur60", "LocalAverage"], ["deblur60", "GlobalHistogram"],
  ];
  let lastPhoto = null;
  $("#btn-snap").addEventListener("click", async () => {
    const t = stream && stream.getVideoTracks()[0]; if (!t) return;
    const btn = $("#btn-snap"); btn.disabled = true; btn.textContent = "Reading…";
    $("#btn-save-photo").hidden = true;
    lastSeen = "";
    try {
      await loadZXing();
      let bmp;
      if ("ImageCapture" in window) {
        try { bmp = await createImageBitmap(await new ImageCapture(t).takePhoto()); } catch { /* fall back to a video frame */ }
      }
      if (!bmp) bmp = await createImageBitmap($("#video"));
      const hit = await decodePhoto(bmp);
      $("#cam-diag").textContent = `photo ${bmp.width}×${bmp.height} · ${hit ? "read by " + hit.by : lastSeen || "no barcode found"}`;
      if (hit) onDecoded(hit.text, hit.by + "-photo");
      else {
        beep(false);
        // keep the photo so it can be saved and sent to IT for a look
        const full = document.createElement("canvas");
        full.width = bmp.width; full.height = bmp.height;
        full.getContext("2d").drawImage(bmp, 0, 0);
        lastPhoto = full;
        $("#btn-save-photo").hidden = false;
        toast(lastSeen
          ? "Barcode found but damaged or blurry. Tilt the slide to remove glare and try again, or type it with ⌨."
          : "No barcode found. Zoom in so the label fills the square, or type it with ⌨.", "warn");
      }
    } catch (e) {
      toast("Photo failed: " + e.message, "warn");
    } finally {
      btn.disabled = false; btn.textContent = "📸 Photo";
    }
  });
  // centre crops (the square is in the middle), smallest first, each resized to a workable size
  async function decodePhoto(bmp) {
    const tries = [[0.25, 900], [0.34, 1000], [0.5, 1200], [0.34, 600], [0.7, 1400], [1, 1600]];
    for (const [f, size] of tries) {
      const side = Math.min(bmp.width, bmp.height) * f;
      const sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
      const c = document.createElement("canvas");
      const out = Math.min(size, Math.max(500, Math.round(side * 2)));
      c.width = c.height = out;
      const cx = c.getContext("2d", { willReadFrequently: true });
      cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = "high";
      cx.drawImage(bmp, sx, sy, side, side, 0, 0, out, out);
      const hit = await decodeCanvas(c, true, PHOTO_PASSES);
      if (hit) return hit;
    }
    return null;
  }
  window.__decodePhoto = decodePhoto; // used by the automated tests
  window.__loadZXing = loadZXing;
  $("#btn-save-photo").addEventListener("click", () => {
    if (!lastPhoto) return;
    lastPhoto.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `unreadable-label-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("Photo saved to Downloads.", "ok");
    }, "image/jpeg", 0.92);
  });

  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; torchOn = false;
    $("#camera-wrap").hidden = true;
    $("#cam-extra").hidden = true;
    $("#btn-camera").hidden = false;
  }
  let torchOn = false;
  $("#btn-torch").addEventListener("click", () => {
    const t = stream && stream.getVideoTracks()[0]; if (!t) return;
    torchOn = !torchOn; t.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
  });
  $("#btn-camera").addEventListener("click", startCamera);
  $("#btn-cam-stop").addEventListener("click", () => { stopCamera(); focusScan(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); });

  // ---------------------------------------------------------------- print report
  function buildReport(s) {
    const sh = s.shipping || {};
    const val = (v) => esc(v || "");
    const methods = ["Courier", "FedEx", "UPS", "USPS", "Hand Delivered"].map((m) =>
      `<span><span class="r-box">${sh.method === m ? "✓" : ""}</span>${m}</span>`).join("") +
      `<span><span class="r-box">${sh.method === "Other" ? "✓" : ""}</span>Other: <span style="display:inline-block;min-width:90pt;border-bottom:.6pt solid #000;font-family:'Courier New',monospace">${sh.method === "Other" ? val(sh.methodOther) : ""}</span></span>`;
    let prev = null;
    const rows = s.slides.map((x, i) => {
      const c = caseOf(x.barcode);
      const brk = prev !== null && c !== prev ? " case-break" : ""; prev = c;
      return `<div class="r-tr${brk}"><span class="n">${i + 1}</span><span class="bc ${c ? "" : "ctrl"}">${esc(x.barcode)}</span><span class="t">${esc(fmtTime(x.time))}</span></div>`;
    }).join("");
    const th = `<div class="r-th"><span>#</span><span>Slide Barcode</span><span>Scan Time</span></div>`;
    return `
      <div class="r-head"><h1>Pathologist Sendout Log</h1><img src="logo.png" alt="GoldPath"></div>
      <div class="r-summary">
        <div><div class="k">Send Date</div><div class="v">${esc(fmtDate(s.date))}</div></div>
        <div><div class="k">Doctor</div><div class="v">${esc(s.doctor || "—")}</div></div>
        <div><div class="k">Slides</div><div class="v">${s.slides.length}</div></div>
        <div><div class="k">Cases</div><div class="v">${countCases(s.slides)}</div></div>
      </div>
      ${s.notes ? `<div class="r-notes"><b>Scan notes:</b> ${esc(s.notes)}</div>` : ""}
      <div class="r-section">Shipping Record</div>
      <div class="r-ship">
        <div class="r-field"><b>Sent by:</b><span class="line">${val(sh.sentBy)}</span></div>
        <div class="r-field"><b>Date / Time sent:</b><span class="line">${val(sh.sentTime)}</span></div>
        <div class="r-methods full"><b>Method:</b>${methods}</div>
        <div class="r-field full"><b>Tracking # / Courier name:</b><span class="line">${val(sh.tracking)}</span></div>
        <div class="r-field"><b>Received by:</b><span class="line"></span></div>
        <div class="r-field"><b>Date received:</b><span class="line"></span></div>
        <div class="r-field"><b>Slides returned:</b><span class="line"></span></div>
        <div class="r-field"><b>Return date:</b><span class="line"></span></div>
        <div class="full"><b>Notes:</b><div class="r-noteslines"><div></div><div></div><div></div></div></div>
      </div>
      <div class="r-section">Slides Sent (${s.slides.length})</div>
      ${s.slides.length ? `<div class="r-colhead">${th}${s.slides.length > 1 ? th : ""}</div><div class="r-cols">${rows}</div>`
                        : `<i>No slides recorded for this send-out.</i>`}`;
  }
  function printReport() {
    if (!current) return;
    stopCamera();
    if (!current.doctor && !confirm("No doctor entered. Print anyway?")) return;
    $("#report").innerHTML = buildReport(current);
    const oldTitle = document.title;
    // becomes the suggested file name for "Save as PDF"
    document.title = `Sendout ${current.date} ${current.doctor || ""}`.trim();
    const img = $("#report img");
    const go = () => { window.print(); setTimeout(() => (document.title = oldTitle), 1000); };
    if (img && !img.complete) img.onload = img.onerror = go; else go();
  }
  $("#btn-print").addEventListener("click", printReport);
  $("#btn-print2").addEventListener("click", printReport);

  // ---------------------------------------------------------------- start
  load();
  route();
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((ok) => {
      $("#storage-note").textContent = ok ? "Saved on this phone." : "Saved on this phone. Use ⋮ → Download backup now and then.";
    }).catch(() => {});
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
