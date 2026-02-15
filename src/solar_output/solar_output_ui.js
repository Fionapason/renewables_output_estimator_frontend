export function showPolygonPVOutput(ref) {
        // FIONA'S CHANGES
        const panel = document.getElementById("polygonoutputPVPanel");
        if (panel) panel.style.display = "block";

}

export function closePolygonPVOutput() {
    removePolygonPVTradeoff();
    const panel = document.getElementById("polygonoutputPVPanel");
    if (panel) panel.style.display = "none";
}
// Display calculated Output
export function setPVOutput_Annual(text) {
    const el = document.getElementById("pvOutput_Annual");
    if (el) el.textContent = `Annual Energy Output: ${text}`;
}

export function setPVOutput_Winter(text) {
    const el = document.getElementById("pvOutput_Winter");
    if (el) el.textContent = `Winter Energy Output: ${text}`;
}

export function setPVOutput_Summer(text) {
    const el = document.getElementById("pvOutput_Summer");
    if (el) el.textContent = `Summer Energy Output: ${text}`;
}

export function setPolygonPVTradeoff(annual_change_percent, winter_change_percent, summer_change_percent) {
    const el_annual = document.getElementById("annual_pv_delta");
    const el_winter = document.getElementById("winter_pv_delta");
    const el_summer = document.getElementById("summer_pv_delta");

    const annual_percent = Number(annual_change_percent);
    el_annual.hidden = false;
    el_annual.textContent = `${annual_percent >= 0 ? "+" : ""}${annual_percent.toFixed(1)}%`;
    el_annual.className = "delta " + (annual_percent > 0 ? "pos" : annual_percent < 0 ? "neg" : "zero");

    const winter_percent = Number(winter_change_percent);
    el_winter.hidden = false;
    el_winter.textContent = `${winter_percent >= 0 ? "+" : ""}${winter_percent.toFixed(1)}%`;
    el_winter.className = "delta " + (winter_percent > 0 ? "pos" : winter_percent < 0 ? "neg" : "zero");

    const summer_percent = Number(summer_change_percent);
    el_summer.hidden = false;
    el_summer.textContent = `${summer_percent >= 0 ? "+" : ""}${summer_percent.toFixed(1)}%`;
    el_summer.className = "delta " + (summer_percent > 0 ? "pos" : summer_percent < 0 ? "neg" : "zero");
}

export function removePolygonPVTradeoff() {
    const el_annual = document.getElementById("annual_pv_delta");
    const el_winter = document.getElementById("winter_pv_delta");
    const el_summer = document.getElementById("summer_pv_delta");

    el_annual.hidden = true;
    el_winter.hidden = true;
    el_summer.hidden = true;
}



// pv_loader.js
let rafId = null;
let t0 = 0;

function setupHiDPI(canvas, ctx) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    // Use layout size if available; otherwise fall back to HTML attributes (CSS pixels)
    const rect = canvas.getBoundingClientRect();
    let cssW = rect.width;
    let cssH = rect.height;

    if (!cssW || !cssH) {
        cssW = Number(canvas.getAttribute("width")) || 260;
        cssH = Number(canvas.getAttribute("height")) || 120;
    }

    // Hard clamp to avoid exceeding browser/GPU limits
    const MAX = 8192; // conservative & safe
    const bw = Math.min(MAX, Math.max(1, Math.round(cssW * dpr)));
    const bh = Math.min(MAX, Math.max(1, Math.round(cssH * dpr)));

    // Only resize if needed (prevents churn)
    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
    }

    // draw in CSS pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { w: cssW, h: cssH };
}


function drawGridPanel(ctx, x, y, w, h) {
  ctx.save();

  // ---- geometry: a right-leaning parallelogram "facing" the sun ----
  // positive skew pushes the top edge to the right (tweak this)
  const skew = Math.min(w * 0.22, 28);

  // corners (clockwise)
  const A = { x: x, y: y };       // top-left
  const B = { x: x + w , y: y };   // top-right
  const C = { x: x + w + skew, y: y + h };      // bottom-right
  const D = { x: x + skew, y: y + h };          // bottom-left

  // panel body
  ctx.fillStyle = "rgb(37,49,73)";
  ctx.strokeStyle = "rgba(129,128,128,0.6)";
  ctx.lineWidth = 5;

  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(C.x, C.y);
  ctx.lineTo(D.x, D.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // grid
  ctx.strokeStyle = "rgba(129,128,128,0.6)";
  ctx.lineWidth = 1;

  const cols = 5;
  const rows = 4;

  // helper: linear interpolation between 2 points
  const lerpP = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });

  // vertical-ish grid lines: connect points on AB to points on DC
  for (let i = 1; i < cols; i++) {
    const t = i / cols;
    const pTop = lerpP(A, B, t);
    const pBot = lerpP(D, C, t);
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pBot.x, pBot.y);
    ctx.stroke();
  }

  // horizontal-ish grid lines: connect points on AD to points on BC
  for (let j = 1; j < rows; j++) {
    const t = j / rows;
    const pLeft = lerpP(A, D, t);
    const pRight = lerpP(B, C, t);
    ctx.beginPath();
    ctx.moveTo(pLeft.x, pLeft.y);
    ctx.lineTo(pRight.x, pRight.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSunWithRays(ctx, cx, cy, r, activeIdx, stepProg) {
    // sun disk
    ctx.save();
    ctx.fillStyle = "rgb(227,193,118)";
    //ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    //ctx.stroke();

    // 12 rays
    const n = 12;
    const baseLen = 10;
    const peakExtra = 14; // how much longer the active ray gets
    const inner = r + 4;

    for (let i = 0; i < n; i++) {
        const ang = (i * 2 * Math.PI) / n - Math.PI / 2;

        // active ray "peeks" out (grows) while others are faint
        const isActive = i === activeIdx;
        const grow = isActive ? stepProg : 0;
        const len = baseLen + peakExtra * grow;

        ctx.strokeStyle = isActive ? "rgb(227,193,118)" : "rgb(159,138,97)";
        ctx.lineWidth = isActive ? 3 : 2;
        ctx.lineCap = "round";

        const x1 = cx + Math.cos(ang) * inner;
        const y1 = cy + Math.sin(ang) * inner;
        const x2 = cx + Math.cos(ang) * (inner + len);
        const y2 = cy + Math.sin(ang) * (inner + len);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    ctx.restore();
}

function frame(ts, canvas, ctx) {

    if (!t0) t0 = ts;
    const { w, h } = setupHiDPI(canvas, ctx);

    // timing: advance one ray every 110ms
    const stepMs = 110;
    const elapsed = ts - t0;
    const step = Math.floor(elapsed / stepMs);
    const activeIdx = step % 12;
    const stepProg = Math.min(1, (elapsed % stepMs) / stepMs); // 0..1

    // clear
    ctx.clearRect(0, 0, w, h);

    // layout
    const pad_x = 40;
    const pad_y = 14;
    const panelW = Math.min(130, w * 0.55);
    const panelH = Math.min(80, h - pad_y * 2);
    const panelX = pad_x;
    const panelY = (h - panelH) / 2;

    const sunCx = panelX + panelW + (w - (panelX + panelW)) * 0.45;
    const sunCy = h / 2;
    const sunR = 16;

    drawGridPanel(ctx, panelX, panelY, panelW, panelH);
    drawSunWithRays(ctx, sunCx, sunCy, sunR, activeIdx, stepProg);

    rafId = requestAnimationFrame((t) => frame(t, canvas, ctx));
}

export function startPVLoader() {

    // avoid double-start
    stopPVLoader();

    const box = document.getElementById("PVLoader");
    const canvas = document.getElementById("loadingCanvas_pv");
    if (!box || !canvas) return;

    box.hidden = false;

    const ctx = canvas.getContext("2d");
    t0 = 0;
    rafId = requestAnimationFrame((t) => frame(t, canvas, ctx));
}

export function stopPVLoader() {

    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    t0 = 0;

    const box = document.getElementById("PVLoader");
    const canvas = document.getElementById("loadingCanvas_pv");

    if (canvas) {
        console.log("Canvas")
        const ctx = canvas.getContext("2d");
        // clear (use CSS pixels; ctx is reset each frame anyway)
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (box) box.hidden = true;
}
