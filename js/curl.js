// Paper page curl: the geometry and per-frame rendering of a folding page.
//
// Model (stage coordinates, page = [0,w] x [0,h], spine on the left edge):
//  - A turn holds the page at P0 = (w, ay) on its right edge; ay is the
//    height where the finger first touched (or the bottom corner for taps).
//  - The held paper point moves to F. The fold line is the perpendicular
//    bisector of P0-F; everything on P0's side of it is folded over, i.e.
//    reflected across the fold, and shows the back of the paper.
//  - `u` is how far the held point has travelled toward the spine:
//    0 = page flat, 2w = folded right over onto the left (off screen).
//    F = (w - u, ay + vy + bias(u)), where bias lifts the corner on a slight
//    arc (and tilts the fold toward the nearer corner for grabs high or low
//    on the page), and F is clamped so the fold never crosses the spine.
//
// Rendering only touches clip-path, transform and opacity:
//  - the turning leaf's front face is clipped to the unfolded part;
//  - its flap (back of the paper, with a faint mirrored ghost of the text)
//    is clipped to the folded part and reflected across the fold;
//  - three gradient bands aligned to the fold give the shading: curvature on
//    the flap, a soft shadow on the page beside the flap, and the shadow
//    cast onto the page underneath (plus a light dimming of that page).

const TILT = 0.24; // extra fold tilt for grabs near the top/bottom
const ARC = 0.06;  // how much every corner rises mid-turn (fraction of w)

/** Markup for one leaf: the page face plus its flap. */
export const LEAF_HTML =
  '<div class="face front"><div class="page text"></div>' +
  '<div class="fx fx-dim"></div><div class="fx fx-band fx-cast"></div><div class="fx fx-band fx-crease"></div></div>' +
  '<div class="flap"><div class="flap-ghost"></div><div class="fx fx-band fx-curve"></div></div>';

export function attachLeaf(leaf) {
  const q = (s) => leaf.querySelector(s);
  leaf.pageEl = q('.page');
  leaf.front = q('.front');
  leaf.dim = q('.fx-dim');
  leaf.cast = q('.fx-cast');
  leaf.crease = q('.fx-crease');
  leaf.flap = q('.flap');
  leaf.ghost = q('.flap-ghost');
  leaf.curve = q('.fx-curve');
  leaf.ghostHTML = null;
}

/**
 * A grab: where on the page the paper is held. `y` is the touch height in
 * stage coordinates (null = scripted turn from the bottom corner).
 */
export function makeGrab(w, h, y) {
  const ay = y == null ? h : Math.min(h, Math.max(0, y));
  // -1 (top) .. 0 (middle band) .. 1 (bottom): which corner peels, blended.
  const t = (ay / h - 0.5) * 2;
  const s = Math.sign(t) * smooth(0.22, 0.9, Math.abs(t));
  const r1 = Math.hypot(w, ay);      // held point to top of spine
  const r2 = Math.hypot(w, h - ay);  // held point to bottom of spine
  return { w, h, ay, s, r1, r2, band: Math.ceil(2.2 * Math.hypot(w, h)) };
}

/** The moving paper point for progress u and vertical offset vy. */
export function foldPoint(g, u, vy) {
  const { w, h, ay } = g;
  const uu = Math.min(2 * w, Math.max(0, u));
  const bias = -(TILT * g.s + ARC) * (uu * (2 * w - uu)) / w;
  let x = w - uu;
  let y = ay + vy + bias;
  // Paper is attached along the spine: each spine end keeps its distance to
  // the held point, so F stays inside both circles (alternating projection).
  for (let i = 0; i < 4; i++) {
    let d = Math.hypot(x, y);
    if (d > g.r1) { x *= g.r1 / d; y *= g.r1 / d; }
    d = Math.hypot(x, y - h);
    if (d > g.r2) { x *= g.r2 / d; y = h + (y - h) * (g.r2 / d); }
  }
  return { x, y };
}

/** Prepare a leaf to be curled (fills the flap's ghost text if stale). */
export function begin(leaf) {
  const html = leaf.pageEl.innerHTML;
  if (leaf.ghostHTML !== html) {
    leaf.ghost.innerHTML = html;
    leaf.ghostHTML = html;
  }
  leaf.ghost.className = 'flap-ghost ' + leaf.pageEl.className;
}

/** Remove all curl styling from a leaf (both its turning and its "under" roles). */
export function clear(leaf) {
  leaf.front.style.clipPath = '';
  leaf.front.style.webkitClipPath = '';
  leaf.flap.style.visibility = '';
  leaf.flap.style.transform = '';
  leaf.flap.style.clipPath = '';
  leaf.flap.style.webkitClipPath = '';
  for (const fx of [leaf.dim, leaf.cast, leaf.crease, leaf.curve]) { fx.style.opacity = ''; fx.style.transform = ''; }
}

/** Shadows on the page underneath only. */
export function clearUnder(leaf) {
  for (const fx of [leaf.dim, leaf.cast]) { fx.style.opacity = ''; fx.style.transform = ''; }
}

const NONE = 'polygon(0px 0px, 0px 0px, 0px 0px)';
const f1 = (v) => Math.round(v * 10) / 10;

function poly(pts) {
  if (pts.length < 3) return NONE;
  let s = 'polygon(';
  for (let i = 0; i < pts.length; i++) s += (i ? ', ' : '') + f1(pts[i][0]) + 'px ' + f1(pts[i][1]) + 'px';
  return s + ')';
}

function setClip(el, v) { el.style.clipPath = v; el.style.webkitClipPath = v; }

/** A gradient band whose top edge lies on the fold, pointing along angle a (deg). */
function band(el, g, mx, my, a, depth, opacity) {
  el.style.transform =
    `translate(${f1(mx)}px, ${f1(my)}px) rotate(${f1(a - 90)}deg) translate(${-g.band / 2}px, 0px) scale(${g.band / 100}, ${Math.max(0.01, depth) / 100})`;
  el.style.opacity = opacity.toFixed(3);
}

/**
 * Pose a curl: `turn` is the leaf folding over, `under` the leaf revealed
 * beneath it. u, vy as in foldPoint().
 */
export function pose(turn, under, g, u, vy) {
  const { w, h, ay } = g;
  const F = foldPoint(g, u, vy);
  const dx = w - F.x, dy = ay - F.y;
  const L = Math.hypot(dx, dy);
  if (L < 0.5) {
    clear(turn);
    clearUnder(under);
    return;
  }
  const nx = dx / L, ny = dy / L;          // unit normal, toward the folded side
  const mx = (w + F.x) / 2, my = (ay + F.y) / 2;

  // Split the page rectangle along the fold.
  const keep = [], fold = [];
  const P = [[0, 0], [w, 0], [w, h], [0, h]];
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) & 3];
    const da = (a[0] - mx) * nx + (a[1] - my) * ny;
    const db = (b[0] - mx) * nx + (b[1] - my) * ny;
    (da <= 0 ? keep : fold).push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      keep.push(p); fold.push(p);
    }
  }
  setClip(turn.front, poly(keep));

  // Flap: reflection across the fold, X' = X - 2((X-M).n) n.
  const k = 2 * (mx * nx + my * ny);
  const fl = turn.flap;
  fl.style.transform =
    `matrix(${(1 - 2 * nx * nx).toFixed(5)}, ${(-2 * nx * ny).toFixed(5)}, ${(-2 * nx * ny).toFixed(5)}, ${(1 - 2 * ny * ny).toFixed(5)}, ${f1(k * nx)}, ${f1(k * ny)})`;
  setClip(fl, poly(fold));
  fl.style.visibility = 'visible';

  // Shading. q = progress; lift = how far the paper stands off the page.
  const q = Math.min(1, u / (2 * w));
  const start = Math.min(1, L / 70);
  const end = 1 - smooth(0.82, 1, q);
  const lift = start * end * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, q * 1.4)));
  const half = L / 2;                                   // fold to held point
  const toP0 = (Math.atan2(ny, nx) * 180) / Math.PI;    // direction of the folded side

  band(turn.curve, g, mx, my, toP0, Math.min(half, w * 0.75), start * end);
  // Beside the flap the shadow hugs the crease; once both right corners are
  // folded the flap's far edge runs along the fold, so reach out to it.
  const dTop = (w - mx) * nx + (0 - my) * ny;
  const dBot = (w - mx) * nx + (h - my) * ny;
  const strip = smooth(-40, 40, Math.min(dTop, dBot));
  const reach = Math.min(half, 46) + (half - Math.min(half, 46)) * strip;
  band(turn.crease, g, mx, my, toP0 + 180, reach + 16 + 10 * lift, lift);
  band(under.cast, g, mx, my, toP0, 14 + Math.min(half, w * 0.55) * 0.5, lift);
  under.dim.style.opacity = (start * Math.pow(1 - q, 1.4)).toFixed(3);
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
