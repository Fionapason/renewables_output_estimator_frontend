import {optimizePolygon} from "./wind_api.js";

let currentPoly = null;
const turbine_size = 6;

export function showPolygonOutput(ref) {
        // FIONA'S CHANGES
        const polygonOutput = document.getElementById("polygonturbine_windOutput");

        const panel = document.getElementById("polygonoutputPanel");
        if (panel) panel.style.display = "block";

    }

export function closePolygonOutput() {
    const panel = document.getElementById("polygonoutputPanel");
    if (panel) panel.style.display = "none";
}

// Display calculated Output
export function setPolygonWindOutput(text_polygon) {
    const el_polyongturbine = document.getElementById("polygonturbine_windOutput");
    if (el_polyongturbine) el_polyongturbine.textContent = `Annual Energy Output: ${text_polygon}`;
}

export function setSelectedWindOutput(text_single) {
    const el_singleturbine = document.getElementById("singleturbine_windOutput");
    if (el_singleturbine) el_singleturbine.textContent = `Annual Energy Output: ${text_single}`
}

export function createOptimizerCanvasLoader({
      canvasId = "optimizerCanvas",
      nTurbines = 5,
      retargetEveryMs = 2000
    } = {}) {

      const MIN_DIST = 22; // px (tune visually)
      const canvas = document.getElementById(canvasId);

      if (!canvas) throw new Error(`Canvas not found: #${canvasId}`);

      const ctx = canvas.getContext("2d");

      // Handle CSS-scaled canvas: keep drawing in device pixels for crispness
      function resizeForDPR() {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
      }

      // Turbines: current pos + target pos
      const turbines = Array.from({ length: nTurbines }, () => ({
        x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0
      }));

      function rand(min, max) { return min + Math.random() * (max - min); }

      // Create a “layout”: grid-ish with jitter (looks like iterative optimization)
      function makeTargets(width, height) {

        const size = turbine_size;                 // must match what you pass to drawTurbine(...)
        const mastLen = size * 2.4;
        const bladeLen = size * 1.6;
        const topClearance = mastLen + bladeLen + 6;  // extra padding
        const sidePad = 16;
        const bottomPad = 16;


        const cx = width / 2;
        const cy = height / 2 + topClearance * 0.35;        // pushes bases downward
        const radius = Math.min(width, height) * 0.42;       // your old radius
        const usableRadius = radius - sidePad;               // small inset

        const poly = makeHexagon(cx, cy, usableRadius);


        for (let i = 0; i < nTurbines; i++) {
          let p, tries = 0;
          do {
            p = sampleInPoly(poly);
            tries++;
            if (p.y < topClearance) continue; // try again
          } while (tooClose(p.x, p.y, turbines.slice(0, i), MIN_DIST) && tries < 50);

          turbines[i].tx = p.x;
          turbines[i].ty = p.y;
        }


        // optional: draw the polygon outline
        currentPoly = poly;
      }

      // Initialize positions in a cluster
      function initPositions(width, height) {
        const cx = width / 2;
        const cy = height / 2;
        turbines.forEach(t => {
          t.x = cx + rand(-25, 25);
          t.y = cy + rand(-18, 18);
          t.tx = t.x;
          t.ty = t.y;
          t.vx = 0;
          t.vy = 0;
        });
      }

      let raf = 0;
      let running = false;
      let lastRetarget = 0;

      function step(ts) {
        if (!running) return;

        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        // Retarget periodically
        if (ts - lastRetarget > retargetEveryMs) {
          makeTargets(w, h);
          lastRetarget = ts;
        }

        // Physics-ish easing toward targets
        const stiffness = 0.036;  // pull strength
        const damping = 0.5;    // velocity damping

        for (const t of turbines) {
          const ax = (t.tx - t.x) * stiffness;
          const ay = (t.ty - t.y) * stiffness;
          t.vx = (t.vx + ax) * damping;
          t.vy = (t.vy + ay) * damping;
          t.x += t.vx;
          t.y += t.vy;
        }




        // Draw
        ctx.clearRect(0, 0, w, h);

        if (currentPoly) {
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          currentPoly.forEach(([x,y], idx) => idx ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
          ctx.closePath();
          ctx.strokeStyle = "#333";
          ctx.stroke();
          ctx.globalAlpha = 1;
        }


        // Simple “wake” lines (purely visual): faint lines behind motion direction
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1;
        for (const t of turbines) {
          const lx = t.x - t.vx * 7;
          const ly = t.y - t.vy * 7;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(t.x, t.y);
          ctx.strokeStyle = "#666";
          ctx.stroke();
        }

        // Turbine dots
        ctx.globalAlpha = 1;
        const bladeSpin = ts * 0.002; // tweak speed
          for (const t of turbines) {
            drawTurbine(ctx, t.x, t.y, turbine_size, bladeSpin);
          }

        raf = requestAnimationFrame(step);
      }

      function start() {
        if (running) return;
        resizeForDPR();
        const rect = canvas.getBoundingClientRect();
        initPositions(rect.width, rect.height);
        makeTargets(rect.width, rect.height);
        lastRetarget = performance.now();
        running = true;
        raf = requestAnimationFrame(step);
      }

      function stop() {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        // optional: clear canvas
        const rect = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);
      }

      window.addEventListener("resize", () => {
        if (!running) return;
        resizeForDPR();
      });

      return { start, stop };
}

function makeHexagon(cx, cy, radius) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6; // flat-top hex
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function sampleInPoly(poly, tries = 200) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  for (let k = 0; k < tries; k++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (pointInPoly(x, y, poly)) return { x, y };
  }
  // fallback: center
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function drawTurbine(ctx, xBase, yBase, size, angle) {
  const mastLen = size * 2.4;
  const hubX = xBase;
  const hubY = yBase - mastLen;

  // mast
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#222";
  ctx.beginPath();
  ctx.moveTo(xBase, yBase);
  ctx.lineTo(hubX, hubY);
  ctx.stroke();

  // hub
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(hubX, hubY, size * 0.35, 0, Math.PI * 2);
  ctx.fill();

  // blades
  for (let i = 0; i < 3; i++) {
    const a = angle + i * (Math.PI * 2 / 3);
    const bx = hubX + Math.cos(a) * size * 1.6;
    const by = hubY + Math.sin(a) * size * 1.6;

    ctx.beginPath();
    ctx.moveTo(hubX, hubY);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // base dot (optional, looks nice)
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(xBase, yBase, 1.5, 0, Math.PI * 2);
  ctx.fill();
}


function tooClose(x, y, others, minD) {
  const d2 = minD * minD;
  for (const o of others) {
    const dx = x - o.tx;
    const dy = y - o.ty;
    if (dx*dx + dy*dy < d2) return true;
  }
  return false;
}