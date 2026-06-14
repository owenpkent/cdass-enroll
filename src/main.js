import {
  PROFILE_SECTIONS,
  EMPLOYER_SECTIONS,
  blankProfile,
  displayName,
  scrubSensitive,
} from "./schema.js";
import * as store from "./store.js";
import { scanLicense, scanLicenseFront, scanPassport, scanSsnCard, readLicenseRegion } from "./extract/scanner.js";
import { fillPacket2026 } from "./fill/packet2026.js";
import { fillI9Standalone } from "./fill/i9.js";
import { fillW4 } from "./fill/w4.js";
import { todayIso } from "./fill/util.js";

// This is a one-at-a-time tool: a single person's profile, plus the standing
// "your details" (member + employer of record) that get reused on every packet.
const state = {
  profile: store.loadProfile(),
  employer: store.loadEmployer(),
  genOptions: { signatureDate: todayIso(), firstDay: "", rateEffectiveDate: "", newService: true },
  showSettings: false,
};

// Retention backstop: clear the saved person if untouched longer than the setting.
if (store.purgeStaleProfile()) {
  state.profile = store.loadProfile();
  state.purgedNote = "The previously saved person was auto-cleared (older than the retention period set in Your details).";
}

// Pre-fill the standing details from seed.local.json on a fresh browser profile.
store.applySeedIfEmpty().then((applied) => {
  if (applied) {
    state.employer = store.loadEmployer();
    render();
  }
});

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
function inputType(f) {
  return { date: "date", email: "email", phone: "tel", money: "number", ssn: "text", text: "text" }[f.type] ?? "text";
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
        const inp = h("input", {
          type: inputType(f),
          value: obj[f.key] ?? "",
          placeholder: f.placeholder ?? "",
          oninput: (e) => {
            obj[f.key] = e.target.value;
            onChange(f.key);
          },
        });
        inp.dataset.key = f.key;
        body.append(h("label", { class: "field" + (f.width === "s" ? " w-s" : "") }, f.label, inp));
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
    if (el.value !== String(obj[k] ?? "")) el.value = obj[k] ?? "";
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
function renderSignatureField(f, obj, onChange) {
  const preview = h("img", { class: "sigpreview", alt: "" });
  const show = () => {
    if (obj[f.key]) {
      preview.src = obj[f.key];
      preview.style.display = "block";
    } else {
      preview.removeAttribute("src");
      preview.style.display = "none";
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
        onChange(f.key);
        show();
      } catch (err) {
        alert("Could not read that image: " + err.message);
      }
    },
  });
  show();
  return h(
    "div",
    { class: "field sigfield" },
    h("span", {}, f.label),
    preview,
    h(
      "div",
      { class: "btnrow" },
      h("button", { class: "btn", onclick: () => fileInp.click() }, "Upload signature image"),
      h("button", { class: "btn", onclick: () => { obj[f.key] = ""; onChange(f.key); show(); } }, "Clear"),
      fileInp
    )
  );
}

// ---------- shell ----------
function render() {
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
      const { fields, source } = await scanFn(file);
      const changed = applyScanFields(fields);
      const warn = fields.passportNumberUnverified
        ? ` Passport number "${fields.passportNumberUnverified}" failed its check digit; verify it manually.`
        : "";
      setScanStatus(
        "ok",
        `${source}: filled ${changed.size} field${changed.size === 1 ? "" : "s"} (${[...changed].join(", ") || "none new"}). Review below before generating.${warn}`
      );
      cropArea.replaceChildren();
    } catch (e) {
      if (onFail) onFail(file, e);
      else setScanStatus("err", e.message);
    }
  }

  // When the license barcode won't auto-decode, show the photo and let the user
  // box the barcode; that region is enlarged and decoded.
  async function showCropper(file, err) {
    setScanStatus("err", err.message);
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
          setScanStatus("busy", "Reading the selected area...");
          try {
            const { fields, source } = await readLicenseRegion(
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
      h("p", { class: "note", style: "margin-bottom:0.4rem" }, "Drag a box around just the striped barcode, then read it. A tight box around the bars works best."),
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

  async function generate() {
    const profile = state.profile;
    if (!packetCb.checked && !w4Cb.checked && !i9Cb.checked) return setGenStatus("err", "Select at least one form.");
    setGenStatus("busy", "Filling forms locally...");
    try {
      const stem = `${profile.last || "attendant"}-${profile.first || ""}`.replace(/[^\w-]+/g, "");
      if (packetCb.checked) {
        const bytes = await fetchTemplate("forms/CO-CDASS-Attendant-Packet-2026.pdf");
        download(await fillPacket2026(bytes, profile, state.employer, opts), `${stem}-CDASS-packet-2026.pdf`);
      }
      if (w4Cb.checked) {
        const bytes = await fetchTemplate("forms/w4.pdf");
        download(await fillW4(bytes, profile, state.employer, opts), `${stem}-W4.pdf`);
      }
      if (i9Cb.checked) {
        const bytes = await fetchTemplate("forms/i9.pdf");
        download(await fillI9Standalone(bytes, profile, state.employer, opts), `${stem}-I9.pdf`);
      }
      setGenStatus("ok", "Done. Files are in your Downloads folder. Review every page, then sign and date by hand where required.");
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
                  h("p", { class: "note" }, 'Kept. It will still auto-clear after the retention period (see "Your details"), or use "Start over" below.')
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
      h("h2", {}, "Step 1: Upload identification documents"),
      h(
        "div",
        { class: "scanrow" },
        scanButton("License barcode", "Back of card (most accurate)", scanLicense, showCropper),
        scanButton("License front", "Front photo: DOB + address", scanLicenseFront),
        scanButton("Passport", "Photo page, straight on", scanPassport),
        scanButton("Social Security card", "Front, well lit", scanSsnCard)
      ),
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
        dateField("First day of employment (I-9 / W-4)", "firstDay"),
        dateField("Rate effective date", "rateEffectiveDate")
      ),
      h("h3", {}, "Forms to generate"),
      h("label", { class: "check" }, packetCb, "PPL CDASS Attendant Packet 2026 (enrollment, agreement, direct deposit, rates, tax exemptions, EVV exemption, I-9)"),
      h("label", { class: "check" }, w4Cb, "IRS W-4 withholding (2026 revision, as distributed by PPL)"),
      h("label", { class: "check" }, i9Cb, "Standalone USCIS I-9 (the packet already includes one; only if PPL asks for it separately)"),
      h("label", { class: "check" }, newServiceCb, "Rate form: this is a new service (uncheck for an hourly-rate change)"),
      h("div", { class: "btnrow" }, h("button", { class: "btn primary", onclick: generate }, "Generate & download")),
      genStatus,
      afterGen,
      h(
        "p",
        { class: "note" },
        "Your employer signature is placed on the employer lines when you upload one in Your details; the attendant and other parties sign by hand. The output is an exact, editable copy of the packet, so you can adjust any field in your PDF reader before printing. The packet's rehire page (Supplement B) shares a field with I-9 List A in the original PDF, so if a passport was used, ignore the mirrored title on that page."
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
  wrap.append(
    h(
      "p",
      { class: "note" },
      "Your standing details, entered once and reused on every packet: the Member receiving care and the employer of record. These auto-fill from your saved file when present."
    ),
    renderSections(EMPLOYER_SECTIONS, state.employer, () => store.saveEmployer(state.employer)),
    renderPrivacyCard()
  );
  return wrap;
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

  const retentionSel = h(
    "select",
    {
      onchange: (e) => {
        store.setRetention(e.target.value);
        if (store.purgeStaleProfile()) {
          state.profile = store.loadProfile();
          alert("The saved person was older than the new retention period and was cleared.");
          render();
        }
      },
    },
    ...store.RETENTION_CHOICES.map(([v, label]) => {
      const o = h("option", { value: v }, label);
      o.selected = store.getRetentionSetting() === v;
      return o;
    })
  );

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
      "The person's information (including their SSN) is stored in this browser's local storage on this machine, unencrypted. To limit how long it sits there, it is automatically cleared after the retention period below (your standing details are kept and re-seed automatically). Generated PDFs go to your Downloads folder; store and dispose of them like any document containing an SSN."
    ),
    h("label", { class: "field", style: "max-width: 320px" }, "Auto-clear the saved person after", retentionSel),
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

render();
