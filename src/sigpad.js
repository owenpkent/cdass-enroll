// Make a signature in the page: type it (rendered in a handwriting font the
// computer already has) or draw it with the pointer. Either way it becomes a
// transparent PNG data URL cropped to the ink, the same shape an uploaded
// signature image is cleaned into, so the fillers overlay it the same way.
//
// Nothing here decides where a signature goes or whether it is used. main.js
// pairs every signature with its own consent tick.

// System handwriting fonts, so nothing is fetched or bundled: Segoe Script and
// Ink Free ship with Windows, Brush Script MT and Lucida Handwriting with
// macOS and Office. `cursive` is the browser's last resort.
export const SCRIPT_FONTS = '"Segoe Script", "Ink Free", "Lucida Handwriting", "Brush Script MT", cursive';

// Canvases draw at twice their CSS size so the stamped PNG stays crisp.
const W = 960;
const H = 240;
const SCALE = 2;

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids.filter((k) => k != null));
  return node;
}

function sigCanvas(label) {
  const c = el("canvas", { class: "sigcanvas", width: W, height: H, role: "img", "aria-label": label });
  c.style.width = `${W / SCALE}px`;
  return c;
}

/** Render text in the script font, shrinking it until it fits the width. */
export function renderTyped(canvas, text) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!text.trim()) return;
  let size = 96;
  ctx.font = `${size}px ${SCRIPT_FONTS}`;
  while (size > 24 && ctx.measureText(text).width > canvas.width - 40) {
    size -= 4;
    ctx.font = `${size}px ${SCRIPT_FONTS}`;
  }
  ctx.fillStyle = "#111";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 20, canvas.height / 2);
}

/** The ink on a canvas, cropped with a small margin, as a PNG data URL; "" if blank. */
export function cropToInk(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return "";
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/**
 * A type-or-draw signature maker. `name` seeds the typed signature, and the
 * returned element's setName() keeps it current; `onUse` gets the PNG data URL
 * when the person presses "Use this signature".
 */
export function signatureMaker({ name = "", who = "signature", onUse }) {
  let mode = "type";

  // ---- Type ----
  const typed = sigCanvas(`Preview of the typed ${who}`);
  const nameInp = el("input", { type: "text", value: name, "aria-label": `Type the ${who}` });
  let edited = false;
  nameInp.addEventListener("input", () => {
    edited = true;
    renderTyped(typed, nameInp.value);
    sync();
  });
  const typePane = el("div", { class: "sigpane" }, el("label", { class: "field" }, "Type the name as they sign it", nameInp), typed);

  // ---- Draw ----
  const pad = sigCanvas(`Drawing area for the ${who}`);
  pad.classList.add("sigpad");
  let drawing = false;
  let inked = false;
  const at = (e) => {
    const r = pad.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const pctx = pad.getContext("2d");
  pctx.lineWidth = 5;
  pctx.lineCap = "round";
  pctx.lineJoin = "round";
  pctx.strokeStyle = "#111";
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    drawing = true;
    pctx.beginPath();
    pctx.moveTo(...at(e));
    pctx.lineTo(...at(e));
    pctx.stroke();
    inked = true;
    sync();
  });
  pad.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    pctx.lineTo(...at(e));
    pctx.stroke();
  });
  const stop = () => (drawing = false);
  pad.addEventListener("pointerup", stop);
  pad.addEventListener("pointercancel", stop);
  const clearPad = el("button", { class: "btn", type: "button", onclick: () => {
    pctx.clearRect(0, 0, W, H);
    inked = false;
    sync();
  } }, "Clear drawing");
  const drawPane = el("div", { class: "sigpane" }, el("p", { class: "note" }, "Sign in the box with the mouse, a finger, or a pen."), pad, el("div", { class: "btnrow" }, clearPad));

  // ---- Mode switch and output ----
  const typeBtn = el("button", { class: "btn", type: "button", onclick: () => setMode("type") }, "Type");
  const drawBtn = el("button", { class: "btn", type: "button", onclick: () => setMode("draw") }, "Draw");
  const useBtn = el("button", { class: "btn primary", type: "button", onclick: () => {
    const png = cropToInk(mode === "type" ? typed : pad);
    if (png) onUse(png);
  } }, "Use this signature");

  function sync() {
    useBtn.disabled = mode === "type" ? !nameInp.value.trim() : !inked;
  }
  function setMode(m) {
    mode = m;
    typePane.hidden = m !== "type";
    drawPane.hidden = m !== "draw";
    typeBtn.setAttribute("aria-pressed", String(m === "type"));
    drawBtn.setAttribute("aria-pressed", String(m === "draw"));
    sync();
  }

  renderTyped(typed, nameInp.value);
  setMode("type");
  const maker = el(
    "div",
    { class: "sigmaker" },
    el("div", { class: "btnrow", role: "group", "aria-label": `How to make the ${who}` }, typeBtn, drawBtn),
    typePane,
    drawPane,
    el("div", { class: "btnrow" }, useBtn)
  );
  // Follow the name typed elsewhere on the page until someone edits this box.
  maker.setName = (n) => {
    if (edited) return;
    nameInp.value = n;
    renderTyped(typed, n);
    sync();
  };
  return maker;
}
