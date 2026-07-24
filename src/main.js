import {
  PROFILE_SECTIONS,
  EMPLOYER_SECTIONS,
  blankProfile,
  blankEmployer,
  displayName,
  scrubSensitive,
  moneyError,
  moneyErrors,
  normalizeMoney,
} from "./schema.js";
import * as store from "./store.js";
import * as vault from "./crypto/vault.js";
import { scanLicense, scanLicenseFront, scanPassport, scanSsnCard, readLicenseRegion, readNameRegion } from "./extract/scanner.js";
import { readFilledPacket } from "./extract/filledpacket.js";
import { fillPacket2026 } from "./fill/packet2026.js";
import { fillI9Standalone } from "./fill/i9.js";
import { fillW4 } from "./fill/w4.js";
import { todayIso } from "./fill/util.js";

// This is a one-at-a-time tool: a single person's profile, plus the standing
// "your details" (member + employer of record) that get reused on every packet.
const state = {
  profile: blankProfile(),
  employer: blankEmployer(),
  // stampSignature lives here, not in the store, so it is false again on every
  // launch: reusing a saved signature is a decision made once per session.
  genOptions: { signatureDate: todayIso(), firstDay: "", newService: true, stampSignature: false },
  showSettings: false,
  locked: false,
  unlockError: "",
};

// Privacy default: the enrolled person is cleared on every launch, regardless
// of lock state (the encrypted envelope is removed without the passphrase). The
// standing "Your details" are kept.
if (store.clearProfileOnStart()) {
  state.purgedNote = "The previously entered person was cleared. Their information is never kept between sessions; your standing details in Your details are.";
}

// Load the saved data into memory, applying the seed on a fresh browser profile.
async function loadIntoState() {
  state.profile = store.loadProfile();
  state.employer = store.loadEmployer();
  if (await store.applySeedIfEmpty()) state.employer = store.loadEmployer();
}

// Boot: when the store is encrypted, show the unlock gate and wait for the
// passphrase before loading anything; otherwise read straight through.
async function boot() {
  if (store.isLocked()) {
    state.locked = true;
    render();
    return;
  }
  await loadIntoState();
  render();
}

const app = document.getElementById("app");

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "disabled" || k === "selected") el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

// ---------- schema-driven form rendering ----------
// money is a text box on purpose. <input type=number> reports "" for anything
// it cannot parse, so a rate typed as "$18.50" would store as blank and print
// an empty rate box with nothing on screen to show for it.
function inputType(f) {
  return { date: "date", email: "email", phone: "tel", money: "text", ssn: "text", text: "text" }[f.type] ?? "text";
}

function renderSections(sections, obj, onChange) {
  const wrap = h("div");
  for (const section of sections) {
    const body = h("div", { class: "grid" });
    const card = h(
      "div",
      { class: "card", "data-section": section.id },
      h("h2", {}, section.title),
      section.note ? h("p", { class: "note" }, section.note) : null,
      body
    );
    const sync = () => {
      if (section.showIf) card.style.display = section.showIf(obj) ? "" : "none";
      if (section.disableIf) {
        const off = section.disableIf(obj);
        for (const el of body.querySelectorAll("input, select, textarea")) el.disabled = off;
      }
    };
    for (const f of section.fields) {
      if (f.type === "checkbox") {
        const cb = h("input", {
          type: "checkbox",
          onchange: (e) => {
            obj[f.key] = e.target.checked;
            if (f.onToggle) {
              const seeded = f.onToggle(obj);
              refreshInputs(wrap, obj, seeded?.length ? new Set(seeded) : undefined);
            }
            onChange(f.key);
            wrap.dispatchEvent(new CustomEvent("resync", { bubbles: false }));
          },
        });
        cb.checked = !!obj[f.key];
        body.append(h("label", { class: "check" }, cb, f.label));
      } else if (f.type === "select") {
        const sel = h(
          "select",
          {
            onchange: (e) => {
              obj[f.key] = e.target.value;
              onChange(f.key);
            },
          },
          ...f.options.map(([v, label]) => {
            const o = h("option", { value: v }, label);
            o.selected = obj[f.key] === v;
            return o;
          })
        );
        sel.dataset.key = f.key;
        body.append(h("label", { class: "field" + (f.width === "s" ? " w-s" : "") }, f.label, sel));
      } else if (f.type === "signature") {
        body.append(renderSignatureField(f, obj, onChange));
      } else {
        // Money fields carry an inline complaint under the box. It only ever
        // reports; the value is never rewritten behind the typist's back.
        const err = f.type === "money" ? h("div", { class: "fielderr" }) : null;
        const showError = () => {
          if (!err) return;
          const msg = moneyError(obj[f.key]);
          err.textContent = msg ?? "";
          err.style.display = msg ? "block" : "none";
        };
        const inp = h("input", {
          type: inputType(f),
          value: obj[f.key] ?? "",
          placeholder: f.placeholder ?? "",
          oninput: (e) => {
            obj[f.key] = e.target.value;
            showError();
            onChange(f.key);
          },
        });
        if (f.type === "money") {
          inp.inputMode = "decimal";
          inp.dataset.money = "1"; // refreshInputs revalidates these after a scan or import

          // Tidy "$18.50" to "18.50" on the way out of the field. Punctuation
          // only, and only when the result is valid: a rate that is wrong stays
          // on screen exactly as typed, so the correction is visibly the
          // typist's, not the app's.
          inp.addEventListener("change", () => {
            const tidy = normalizeMoney(inp.value);
            if (tidy !== inp.value && !moneyError(tidy)) {
              inp.value = tidy;
              obj[f.key] = tidy;
              onChange(f.key);
            }
            showError();
          });
        }
        inp.dataset.key = f.key;
        showError();
        body.append(h("label", { class: "field" + (f.width === "s" ? " w-s" : "") }, f.label, inp, err));
      }
    }
    sync();
    wrap.addEventListener("resync", () => sync());
    wrap.append(card);
  }
  return wrap;
}

// Push updated values from obj back into rendered inputs (after a scan/scrub).
function refreshInputs(container, obj, changedKeys) {
  for (const el of container.querySelectorAll("[data-key]")) {
    const k = el.dataset.key;
    if (!(k in obj)) continue;
    if (el.value !== String(obj[k] ?? "")) {
      el.value = obj[k] ?? "";
      // A rate arriving from a scan or an imported packet gets the same tidy
      // and the same complaint as one typed by hand.
      if (el.dataset.money) el.dispatchEvent(new Event("change"));
    }
    if (changedKeys?.has(k)) {
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }
  }
}

async function loadImageFile(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read the image file."));
      img.src = URL.createObjectURL(file);
    });
  }
}

// Turn an uploaded photo or scan of a signature into a clean PNG data URL:
// knock out the near-white background so it overlays a form line without a box.
async function cleanSignatureImage(file) {
  const bmp = await loadImageFile(file);
  const scale = Math.min(1, 600 / (bmp.width || 1));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum > 200) d[i + 3] = 0;
    else d[i] = d[i + 1] = d[i + 2] = 17;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// Schema "signature" field: upload an image, show a preview, store a PNG data URL.
//
// There is exactly one of these, the employer signature, and it is standing
// data: uploaded once, reused on every packet. That is also how it ends up on
// the wrong packet, since it outlives the person it was uploaded for. So the
// upload also records whose signature it is and when it arrived, which Step 3
// shows back before anything is stamped.
function renderSignatureField(f, obj, onChange) {
  const preview = h("img", { class: "sigpreview", alt: "" });
  const caption = h("p", { class: "note" });
  const show = () => {
    if (obj[f.key]) {
      preview.src = obj[f.key];
      preview.style.display = "block";
      caption.textContent = signatureProvenance(obj);
      caption.style.display = "block";
    } else {
      preview.removeAttribute("src");
      preview.style.display = "none";
      caption.style.display = "none";
    }
  };
  const fileInp = h("input", {
    type: "file",
    accept: "image/*",
    style: "display:none",
    onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        obj[f.key] = await cleanSignatureImage(file);
        obj.signatureFor = employerName(obj);
        obj.signatureUploadedAt = todayIso();
        onChange(f.key);
        show();
      } catch (err) {
        alert("Could not read that image: " + err.message);
      }
    },
  });
  const clear = () => {
    obj[f.key] = "";
    obj.signatureFor = "";
    obj.signatureUploadedAt = "";
    onChange(f.key);
    show();
  };
  show();
  return h(
    "div",
    { class: "field sigfield" },
    h("span", {}, f.label),
    preview,
    caption,
    h(
      "div",
      { class: "btnrow" },
      h("button", { class: "btn", onclick: () => fileInp.click() }, "Upload signature image"),
      h("button", { class: "btn", onclick: clear }, "Clear"),
      fileInp
    )
  );
}

const employerName = (emp) => [emp.employerFirst, emp.employerLast].filter(Boolean).join(" ");

/** One line saying where a stored signature came from, for the eye before it. */
function signatureProvenance(emp) {
  if (!emp.signatureFor)
    return "Uploaded before this app started recording whose signature it is. Confirm whose it is before stamping it on a packet.";
  const when = emp.signatureUploadedAt ? ` on ${emp.signatureUploadedAt}` : "";
  return `Uploaded${when} for ${emp.signatureFor}.`;
}

// ---------- shell ----------
function render() {
  if (state.locked) {
    app.replaceChildren(renderUnlockGate());
    return;
  }
  app.replaceChildren(
    h(
      "header",
      { class: "app" },
      h("h1", {}, "CDASS Enroll"),
      h("span", { class: "badge" }, "100% local - nothing leaves this computer"),
      h(
        "button",
        {
          class: "btn ghost settings-toggle",
          onclick: () => {
            state.showSettings = !state.showSettings;
            render();
          },
        },
        state.showSettings ? "← Back to enrollment" : "⚙ Your details"
      )
    ),
    state.showSettings ? renderSettings() : renderMain()
  );
}

// The gate shown at boot when the store is encrypted and still locked.
function renderUnlockGate() {
  const input = h("input", { type: "password", placeholder: "Passphrase", style: "width:100%" });
  const err = h("p", { class: "status err", style: state.unlockError ? "" : "display:none" }, state.unlockError);
  const btn = h("button", { class: "btn primary" }, "Unlock");
  const submit = async () => {
    const pass = input.value;
    if (!pass) return;
    btn.disabled = true;
    btn.textContent = "Unlocking...";
    const ok = await store.unlock(pass);
    if (!ok) {
      state.unlockError = "Wrong passphrase, or the saved data is corrupt. Try again.";
      err.textContent = state.unlockError;
      err.style.display = "";
      btn.disabled = false;
      btn.textContent = "Unlock";
      input.value = "";
      input.focus();
      return;
    }
    state.unlockError = "";
    state.locked = false;
    await loadIntoState();
    render();
  };
  btn.onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") submit();
  };
  setTimeout(() => input.focus(), 0);
  return h(
    "div",
    { class: "card unlock" },
    h("h1", {}, "CDASS Enroll"),
    h("p", {}, "This saved data is protected with a passphrase. Enter it to unlock."),
    h("label", { class: "field" }, "Passphrase", input),
    err,
    h("div", { class: "btnrow" }, btn),
    h(
      "p",
      { class: "note" },
      "There is no recovery if the passphrase is lost: without it the data cannot be decrypted."
    )
  );
}

// ---------- main flow: scan -> review -> generate ----------
function renderMain() {
  const wrap = h("div");
  const save = () => store.saveProfile(state.profile);
  const formArea = renderSections(PROFILE_SECTIONS, state.profile, save);

  // ----- Step 1: scan -----
  const scanStatus = h("div", { class: "status" });
  const cropArea = h("div", { class: "croparea" });
  const setScanStatus = (cls, msg) => {
    scanStatus.className = "status " + cls;
    scanStatus.textContent = msg;
  };

  // Apply extracted fields to the profile, flash what changed, return the keys.
  function applyScanFields(fields) {
    const changed = new Set();
    for (const [k, v] of Object.entries(fields)) {
      if (k.endsWith("Unverified")) continue;
      if (state.profile[k] !== v) {
        state.profile[k] = v;
        changed.add(k);
      }
    }
    save();
    refreshInputs(formArea, state.profile, changed);
    formArea.dispatchEvent(new CustomEvent("resync"));
    return changed;
  }

  async function handleScan(file, scanFn, label, onFail) {
    setScanStatus("busy", `Reading ${label} locally... (first OCR run takes a few seconds)`);
    try {
      // The license-front scan can run a dozen sequential OCR passes, so it
      // reports progress; the other scanners ignore the callback.
      const { fields, source } = await scanFn(file, (msg) => setScanStatus("busy", msg));
      const changed = applyScanFields(fields);
      const warn = fields.passportNumberUnverified
        ? ` Passport number "${fields.passportNumberUnverified}" failed its check digit; verify it manually.`
        : "";
      setScanStatus(
        "ok",
        `${source}: filled ${changed.size} field${changed.size === 1 ? "" : "s"} (${[...changed].join(", ") || "none new"}). Review below before generating.${warn}`
      );
      // A front scan that couldn't read the name: offer the name-crop path,
      // which OCRs a tight box far more reliably than the whole card.
      if (scanFn === scanLicenseFront && !state.profile.first && !state.profile.last) {
        offerNameCrop(file);
      } else {
        cropArea.replaceChildren();
      }
    } catch (e) {
      if (onFail) onFail(file, e);
      else setScanStatus("err", e.message);
    }
  }

  // Standing details fill in only where they are still blank, the same rule the
  // seed file uses: importing an old packet must not quietly rewrite the Member
  // or employer of record already set under "Your details".
  function applyEmployerIfEmpty(fields) {
    const filled = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k in state.employer && !state.employer[k] && v) {
        state.employer[k] = v;
        filled.push(k);
      }
    }
    if (filled.length) store.saveEmployer(state.employer);
    return filled;
  }

  // Import a previously filled packet. A filled AcroForm is the most accurate
  // input this app takes (the agency's own field names against values a human
  // already checked and signed), so it goes through the same review path as a
  // scan: every value flashes yellow and nothing is trusted blindly.
  async function handleImport(file) {
    setScanStatus("busy", "Reading the packet locally...");
    try {
      const { profile: got, employer: emp } = await readFilledPacket(await file.arrayBuffer());
      const changed = applyScanFields(got);
      const seeded = applyEmployerIfEmpty(emp);
      const standing = seeded.length ? ` Filled ${seeded.length} empty standing detail${seeded.length === 1 ? "" : "s"}.` : "";
      setScanStatus(
        "ok",
        `Previous packet: filled ${changed.size} field${changed.size === 1 ? "" : "s"}.${standing} ` +
          "Tax, live-in, and work-authorization answers are not imported; set those yourself. Review everything below."
      );
      cropArea.replaceChildren();
    } catch (e) {
      setScanStatus("err", e.message);
    }
  }

  // Two cropper modes: decode a boxed barcode, or OCR a boxed name region. Both
  // reuse the same drag-a-box UI below; only the "read" step and the copy differ.
  const BARCODE_MODE = {
    read: readLicenseRegion,
    busy: "Reading the selected area...",
    hint: "Drag a box around just the striped barcode, then read it. A tight box around the bars works best.",
  };
  const NAME_MODE = {
    read: readNameRegion,
    busy: "Reading the name...",
    hint: "Drag a box around just the name (the one or two name lines, not the address), then read it. A tight box reads far better than the whole card.",
  };

  // The name barely OCRs off a whole license front (the security background
  // swamps it), but a tight crop of just the name reads well. When a front scan
  // leaves the name empty, offer to box it.
  function offerNameCrop(file) {
    cropArea.replaceChildren(
      h("p", { class: "note", style: "margin-bottom:0.4rem" },
        "The name didn't read from the whole card. Box just the name and read that — it works much better."),
      h("div", { class: "btnrow" },
        h("button", { class: "btn primary", onclick: () => showCropper(file, null, NAME_MODE) }, "Draw a box around the name"),
        h("button", { class: "btn", onclick: () => cropArea.replaceChildren() }, "Dismiss"))
    );
  }

  // When the license barcode won't auto-decode, show the photo and let the user
  // box the barcode; that region is enlarged and decoded. With NAME_MODE, the
  // boxed region is OCR'd as a name instead.
  async function showCropper(file, err, mode = BARCODE_MODE) {
    if (err && err.message) setScanStatus("err", err.message);
    let bitmap;
    try {
      bitmap = await loadImageFile(file);
    } catch (e) {
      return setScanStatus("err", e.message);
    }
    const dispScale = Math.min(1, 640 / bitmap.width);
    const dw = Math.max(1, Math.round(bitmap.width * dispScale));
    const dh = Math.max(1, Math.round(bitmap.height * dispScale));
    const canvas = h("canvas", { class: "cropcanvas" });
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    let sel = null;
    let drag = null;
    const redraw = () => {
      ctx.drawImage(bitmap, 0, 0, dw, dh);
      if (sel) {
        ctx.strokeStyle = "#1f6feb";
        ctx.lineWidth = 2;
        ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      }
    };
    redraw();
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * dw, y: ((e.clientY - r.top) / r.height) * dh };
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = at(e);
      sel = { x: drag.x, y: drag.y, w: 0, h: 0 };
      redraw();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const p = at(e);
      sel = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
      redraw();
    });
    const endDrag = () => (drag = null);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    const readBtn = h(
      "button",
      {
        class: "btn primary",
        onclick: async () => {
          const region = sel && sel.w > 8 && sel.h > 8 ? sel : { x: 0, y: 0, w: dw, h: dh };
          const inv = 1 / dispScale;
          setScanStatus("busy", mode.busy);
          try {
            const { fields, source } = await mode.read(
              bitmap,
              region.x * inv,
              region.y * inv,
              region.w * inv,
              region.h * inv
            );
            const changed = applyScanFields(fields);
            setScanStatus("ok", `${source}: filled ${changed.size} field${changed.size === 1 ? "" : "s"}. Review below before generating.`);
            cropArea.replaceChildren();
          } catch (e2) {
            setScanStatus("err", e2.message);
          }
        },
      },
      "Read selected area"
    );
    const cancelBtn = h("button", { class: "btn", onclick: () => cropArea.replaceChildren() }, "Cancel");

    cropArea.replaceChildren(
      h("p", { class: "note", style: "margin-bottom:0.4rem" }, mode.hint),
      canvas,
      h("div", { class: "btnrow" }, readBtn, cancelBtn)
    );
  }

  const scanButton = (label, hint, scanFn, onFail) => {
    const input = h("input", {
      type: "file",
      accept: "image/*",
      onchange: (e) => {
        const file = e.target.files[0];
        if (file) handleScan(file, scanFn, label, onFail);
        e.target.value = "";
      },
    });
    return h(
      "label",
      { class: "scanbtn" },
      h("span", { class: "big" }, "\u{1F4F7}"),
      h("strong", {}, label),
      h("small", {}, hint),
      input
    );
  };

  const importButton = () => {
    const input = h("input", {
      type: "file",
      accept: "application/pdf,.pdf",
      onchange: (e) => {
        const file = e.target.files[0];
        if (file) handleImport(file);
        e.target.value = "";
      },
    });
    return h(
      "label",
      { class: "scanbtn narrow" },
      h("span", { class: "big" }, "\u{1F4C4}"),
      h("strong", {}, "Previous packet"),
      h("small", {}, "A filled PDF from a past hire"),
      input
    );
  };

  // ----- Step 3: generate -----
  const opts = state.genOptions;
  const genStatus = h("div", { class: "status" });
  const afterGen = h("div");
  const setGenStatus = (cls, msg) => {
    genStatus.className = "status " + cls;
    genStatus.textContent = msg;
  };

  const dateField = (label, key) => {
    const inp = h("input", { type: "date", value: opts[key] ?? "", oninput: (e) => (opts[key] = e.target.value) });
    return h("label", { class: "field" }, label, inp);
  };

  const packetCb = h("input", { type: "checkbox" });
  packetCb.checked = true;
  const w4Cb = h("input", { type: "checkbox" });
  w4Cb.checked = true;
  const i9Cb = h("input", { type: "checkbox" });
  i9Cb.checked = false;
  const newServiceCb = h("input", { type: "checkbox", onchange: (e) => (opts.newService = e.target.checked) });
  newServiceCb.checked = opts.newService;

  // Nothing stamps the saved signature unless this is ticked, and it starts
  // unticked every session (see state.genOptions), so a signature uploaded for
  // one packet cannot ride along on the next person's without being looked at.
  const stampCb = h("input", { type: "checkbox", onchange: (e) => (opts.stampSignature = e.target.checked) });
  stampCb.checked = !!opts.stampSignature;

  function renderStampConfirm() {
    const emp = state.employer;
    if (!emp.signature)
      return h(
        "p",
        { class: "note" },
        "No signature is on file, so every signature line is left to be signed by hand. Upload one under Your details to stamp the employer lines."
      );
    const current = employerName(emp);
    const mismatch = emp.signatureFor && current && emp.signatureFor !== current;
    return h(
      "div",
      { class: "card" },
      h("label", { class: "check" }, stampCb, "Stamp this signature on the employer signature lines"),
      h("img", { class: "sigpreview", src: emp.signature, alt: "" }),
      h("p", { class: "note" }, signatureProvenance(emp)),
      mismatch
        ? h(
            "p",
            { class: "status err" },
            `This signature was uploaded for ${emp.signatureFor}, but the employer of record is now ${current}. Upload the right one under Your details, or leave this unticked and sign by hand.`
          )
        : null
    );
  }

  async function generate() {
    const profile = state.profile;
    if (!packetCb.checked && !w4Cb.checked && !i9Cb.checked) return setGenStatus("err", "Select at least one form.");
    // A rate goes onto a form the attendant signs, so one that is not dollars
    // and cents stops here rather than going out at 33.517 an hour.
    const bad = moneyErrors(profile);
    if (bad.length) return setGenStatus("err", `${bad[0].label}: ${bad[0].message}`);
    // The signature is passed only when this packet was confirmed for it.
    const emp = opts.stampSignature ? state.employer : { ...state.employer, signature: "" };
    setGenStatus("busy", "Filling forms locally...");
    try {
      const stem = `${profile.last || "attendant"}-${profile.first || ""}`.replace(/[^\w-]+/g, "");
      if (packetCb.checked) {
        const bytes = await fetchTemplate("forms/CO-CDASS-Attendant-Packet-2026.pdf");
        download(await fillPacket2026(bytes, profile, emp, opts), `${stem}-CDASS-packet-2026.pdf`);
      }
      if (w4Cb.checked) {
        const bytes = await fetchTemplate("forms/w4.pdf");
        download(await fillW4(bytes, profile, emp, opts), `${stem}-W4.pdf`);
      }
      if (i9Cb.checked) {
        const bytes = await fetchTemplate("forms/i9.pdf");
        download(await fillI9Standalone(bytes, profile, emp, opts), `${stem}-I9.pdf`);
      }
      const stamped = state.employer.signature
        ? opts.stampSignature
          ? ` The employer signature on file for ${state.employer.signatureFor || "an unrecorded name"} was stamped on the employer lines.`
          : " No signature was stamped; every signature line is blank."
        : "";
      setGenStatus(
        "ok",
        `Done. Files are in your Downloads folder. Review every page, then sign and date by hand where required.${stamped}`
      );
      offerScrub();
    } catch (e) {
      console.error(e);
      setGenStatus("err", "Failed: " + e.message);
    }
  }

  // After generating, offer to clear sensitive data right away.
  function offerScrub() {
    afterGen.replaceChildren(
      h(
        "div",
        { class: "card", style: "background:#fff8e6; border-color:#e3c66b" },
        h(
          "p",
          { style: "margin-top:0" },
          `Clear ${displayName(state.profile)}'s sensitive data from this computer now? `,
          "This blanks the SSN, date of birth, bank details, and ID document numbers. ",
          "Name, contact, and rates are kept. Do this once the printed forms are signed and you won't need to regenerate."
        ),
        h(
          "div",
          { class: "btnrow" },
          h(
            "button",
            {
              class: "btn primary",
              onclick: () => {
                const cleared = scrubSensitive(state.profile);
                save();
                refreshInputs(formArea, state.profile);
                afterGen.replaceChildren(
                  h("p", { class: "status ok" }, `Cleared ${cleared.length} sensitive field${cleared.length === 1 ? "" : "s"}.`)
                );
              },
            },
            "Clear sensitive data"
          ),
          h(
            "button",
            {
              class: "btn",
              onclick: () =>
                afterGen.replaceChildren(
                  h("p", { class: "note" }, 'Kept for this session. It clears automatically when you close the app, or use "Start over" below.')
                ),
            },
            "Keep for now"
          )
        )
      )
    );
  }

  // ----- assemble the page -----
  if (state.purgedNote) wrap.append(h("p", { class: "note" }, state.purgedNote));

  wrap.append(
    h(
      "div",
      { class: "card" },
      h("h2", {}, "Step 1: Upload documents"),
      h(
        "div",
        { class: "scanrow" },
        scanButton("License barcode", "Back of card (most accurate)", scanLicense, showCropper),
        scanButton("License front", "Front photo: name, DOB + address", scanLicenseFront, (file, e) => showCropper(file, e, NAME_MODE)),
        scanButton("Passport", "Photo page, straight on", scanPassport),
        scanButton("Social Security card", "Front, well lit", scanSsnCard)
      ),
      h(
        "p",
        { class: "note orline" },
        "Or start from paperwork you already have. Reading a filled packet back in is more accurate than any scan, and it brings over identity, contact, address, payment, and rates. The tax, live-in, and work-authorization answers are yours to make, so it leaves those alone."
      ),
      h("div", { class: "scanrow" }, importButton()),
      scanStatus,
      cropArea,
      h(
        "p",
        { class: "note" },
        "Images are decoded in this browser and never stored. Extracted values flash yellow below; always double-check them against the document."
      )
    ),
    h(
      "div",
      { class: "stepintro" },
      h("h2", {}, "Step 2: Their information"),
      h(
        "p",
        { class: "note" },
        "Auto-filled from the scans and from your saved details. Fill in anything the scans can't know (such as banking) and correct any misreads."
      )
    ),
    formArea,
    h(
      "div",
      { class: "card" },
      h("h2", {}, "Step 3: Generate the PDF"),
      h(
        "div",
        { class: "grid" },
        dateField("Signature date (printed on each form)", "signatureDate"),
        dateField("First day of employment (I-9 / W-4)", "firstDay")
      ),
      h("h3", {}, "Forms to generate"),
      h("label", { class: "check" }, packetCb, "PPL CDASS Attendant Packet 2026 (enrollment, agreement, direct deposit, rates, tax exemptions, EVV exemption, I-9)"),
      h("label", { class: "check" }, w4Cb, "IRS W-4 withholding (2026 revision, as distributed by PPL)"),
      h("label", { class: "check" }, i9Cb, "Standalone USCIS I-9 (the packet already includes one; only if PPL asks for it separately)"),
      h("label", { class: "check" }, newServiceCb, "Rate form: this is a new service (uncheck for an hourly-rate change)"),
      h("h3", {}, "Employer signature"),
      renderStampConfirm(),
      h("div", { class: "btnrow" }, h("button", { class: "btn primary", onclick: generate }, "Generate & download")),
      genStatus,
      afterGen,
      h(
        "p",
        { class: "note" },
        "A saved signature is stamped on the employer lines only when you tick the box above, and the tick clears every time the app restarts, so it is never applied to a new person unnoticed. The attendant and all other parties sign by hand. The output is an exact, editable copy of the packet, so you can adjust any field in your PDF reader before printing. The packet's rehire page (Supplement B) shares a field with I-9 List A in the original PDF, so if a passport was used, ignore the mirrored title on that page."
      )
    ),
    h(
      "div",
      { class: "btnrow" },
      h(
        "button",
        {
          class: "btn danger",
          onclick: () => {
            if (!confirm("Clear this person's information and start a new one? This removes their data from this browser.")) return;
            store.clearProfile();
            state.profile = blankProfile();
            store.saveProfile(state.profile);
            // A new person re-confirms the signature: the tick belonged to the
            // packet it was made for.
            state.genOptions.stampSignature = false;
            state.purgedNote = null;
            render();
          },
        },
        "Start over (new person)"
      )
    )
  );
  return wrap;
}

// ---------- settings: your details + privacy ----------
function renderSettings() {
  const wrap = h("div");
  const saveStatus = h("p", { class: "status" });

  // These fields already write on every keystroke, so this button is not what
  // makes a change stick. It exists because nothing on the page said so, which
  // reads as unsaved. It confirms the write, and with encryption on it waits
  // for the ciphertext to actually land before saying so. No locked-store case
  // is handled here: locking swaps the whole app for the unlock gate, so this
  // panel cannot be on screen while the store is locked.
  async function saveNow() {
    saveStatus.className = "status busy";
    saveStatus.textContent = "Saving...";
    try {
      await store.saveEmployer(state.employer);
      const at = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      saveStatus.className = "status ok";
      saveStatus.textContent = `Saved at ${at}, on this machine only.`;
    } catch (e) {
      saveStatus.className = "status err";
      saveStatus.textContent = `Could not save: ${e.message}`;
    }
  }

  wrap.append(
    h(
      "p",
      { class: "note" },
      "Your standing details, entered once and reused on every packet: the Member receiving care and the employer of record. These auto-fill from your saved file when present."
    ),
    renderSections(EMPLOYER_SECTIONS, state.employer, () => store.saveEmployer(state.employer)),
    h(
      "div",
      { class: "card" },
      h("div", { class: "btnrow" }, h("button", { class: "btn primary", onclick: saveNow }, "Save details")),
      h(
        "p",
        { class: "note" },
        "Changes save as you type, so you can leave this page without pressing anything. Save details is here to confirm it."
      ),
      saveStatus
    ),
    renderPrivacyCard()
  );
  return wrap;
}

// Encryption on/off controls inside the privacy card. Renders one of two
// states: a set-passphrase form when off, or manage buttons when on.
function renderEncryptionControls() {
  if (store.isEncrypted()) {
    return h(
      "div",
      { class: "enc-controls" },
      h("p", { class: "status ok" }, "🔒 Saved data is encrypted with your passphrase."),
      h(
        "div",
        { class: "btnrow" },
        h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              const cur = prompt("Current passphrase:");
              if (!cur) return;
              const nw = prompt("New passphrase (use at least four random words):");
              if (!nw) return;
              if (!vault.estimateStrength(nw).ok) {
                alert("That passphrase is too weak. Use at least four random words.");
                return;
              }
              const changed = await store.changePassphrase(cur, nw);
              alert(changed ? "Passphrase changed." : "That current passphrase was wrong.");
            },
          },
          "Change passphrase"
        ),
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              store.lock();
              state.locked = true;
              state.showSettings = false;
              render();
            },
          },
          "Lock now"
        ),
        h(
          "button",
          {
            class: "btn danger",
            onclick: async () => {
              if (!confirm("Turn off encryption? Your saved data will be stored unencrypted again."))
                return;
              await store.disableEncryption();
              render();
            },
          },
          "Turn off encryption"
        )
      )
    );
  }

  const p1 = h("input", { type: "password", placeholder: "Passphrase", style: "width:100%" });
  const p2 = h("input", { type: "password", placeholder: "Confirm passphrase", style: "width:100%" });
  const meter = h("p", { class: "note" }, "Use at least four random words.");
  p1.oninput = () => {
    if (!p1.value) {
      meter.textContent = "Use at least four random words.";
      return;
    }
    const s = vault.estimateStrength(p1.value);
    meter.textContent = `Strength: ${s.label}` + (s.ok ? "" : " - too weak, use at least four random words");
  };
  const form = h(
    "div",
    { class: "enc-form", style: "display:none; max-width:360px" },
    h("label", { class: "field" }, "New passphrase", p1),
    h("label", { class: "field" }, "Confirm", p2),
    meter,
    h(
      "p",
      { class: "note" },
      "There is no recovery if you lose it: without the passphrase the data cannot be decrypted."
    ),
    h(
      "div",
      { class: "btnrow" },
      h(
        "button",
        {
          class: "btn primary",
          onclick: async () => {
            if (p1.value !== p2.value) {
              alert("Passphrases do not match.");
              return;
            }
            if (!vault.estimateStrength(p1.value).ok) {
              alert("That passphrase is too weak. Use at least four random words.");
              return;
            }
            await store.enableEncryption(p1.value);
            render();
          },
        },
        "Encrypt saved data"
      )
    )
  );
  const toggle = h(
    "button",
    {
      class: "btn",
      onclick: () => {
        const showing = form.style.display !== "none";
        form.style.display = showing ? "none" : "";
        if (!showing) p1.focus();
      },
    },
    "Protect saved data with a passphrase"
  );
  return h("div", { class: "enc-controls" }, toggle, form);
}

function renderPrivacyCard() {
  const fileInput = h("input", {
    type: "file",
    accept: ".json,application/json",
    style: "display:none",
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        store.importAll(await f.text());
        state.profile = store.loadProfile();
        state.employer = store.loadEmployer();
        alert("Backup imported.");
        render();
      } catch (err) {
        alert("Import failed: " + err.message);
      }
    },
  });

  return h(
    "div",
    { class: "card privacy" },
    h("h2", {}, "Privacy & your data"),
    h(
      "p",
      {},
      "Everything in this app runs on this computer. Form filling, barcode reading, and OCR all happen inside this browser tab. The app makes no network requests at runtime, has no server, no analytics, and no accounts."
    ),
    h(
      "p",
      {},
      store.isEncrypted()
        ? "The person's information (including their SSN) is cleared automatically when you close the app, and again when you reopen it, so it never lingers between sessions. While you are working, it is held in this browser's local storage on this machine, encrypted with your passphrase. Generated PDFs go to your Downloads folder unencrypted; store and dispose of them like any document containing an SSN."
        : "The person's information (including their SSN) is cleared automatically when you close the app, and again when you reopen it, so it never lingers between sessions. While you are working, it is held in this browser's local storage on this machine, unencrypted; you can turn on passphrase encryption below. Your standing details are kept and re-seed automatically. Generated PDFs go to your Downloads folder; store and dispose of them like any document containing an SSN."
    ),
    h("hr", { class: "soft" }),
    h("h3", {}, "Encryption at rest"),
    renderEncryptionControls(),
    h("hr", { class: "soft" }),
    h(
      "div",
      { class: "btnrow" },
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            const blob = new Blob([store.exportAll()], { type: "application/json" });
            const a = h("a", { href: URL.createObjectURL(blob), download: "cdass-enroll-backup.json" });
            a.click();
          },
        },
        "Export data (JSON)"
      ),
      h("button", { class: "btn", onclick: () => fileInput.click() }, "Import backup"),
      h(
        "button",
        {
          class: "btn danger",
          onclick: () => {
            if (!confirm("Permanently delete the saved person and your standing details from this browser?")) return;
            store.wipeAll();
            state.profile = blankProfile();
            state.employer = store.loadEmployer();
            render();
          },
        },
        "Wipe all data"
      ),
      fileInput
    )
  );
}

async function fetchTemplate(path) {
  const res = await fetch(new URL(path, document.baseURI));
  if (!res.ok) throw new Error(`Could not load template ${path} (HTTP ${res.status})`);
  return res.arrayBuffer();
}

function download(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Best-effort: wipe the person the instant the tab is closed or navigated away,
// so their data does not linger in storage between sessions. clearProfileOnStart
// above is the guarantee (it still runs next launch if this is skipped, e.g. a
// crash or a straggling async encrypt write). pagehide, not visibilitychange,
// so switching tabs does not wipe a person mid-edit.
window.addEventListener("pagehide", () => store.clearProfile());

boot();
