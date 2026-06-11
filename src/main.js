import {
  PROFILE_SECTIONS,
  EMPLOYER_SECTIONS,
  blankProfile,
  displayName,
} from "./schema.js";
import * as store from "./store.js";
import { scanLicense, scanPassport, scanSsnCard } from "./extract/scanner.js";
import { fillPacket2026 } from "./fill/packet2026.js";
import { fillW4 } from "./fill/w4.js";
import { todayIso } from "./fill/util.js";

const state = {
  tab: "employees",
  profiles: store.loadProfiles(),
  employer: store.loadEmployer(),
  editingId: null,
  genOptions: { signatureDate: todayIso(), firstDay: "", rateEffectiveDate: "", newService: true },
};

// Pre-fill employer settings from seed.local.json on a fresh browser profile.
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
    const card = h("div", { class: "card", "data-section": section.id }, h("h2", {}, section.title), body);
    const sync = () => {
      if (section.showIf) card.style.display = section.showIf(obj) ? "" : "none";
    };
    for (const f of section.fields) {
      if (f.type === "checkbox") {
        const cb = h("input", {
          type: "checkbox",
          onchange: (e) => {
            obj[f.key] = e.target.checked;
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

// Push updated values from obj back into rendered inputs (after a scan).
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

// ---------- persistence ----------
function saveProfile(profile) {
  const i = state.profiles.findIndex((p) => p.id === profile.id);
  if (i >= 0) state.profiles[i] = profile;
  else state.profiles.push(profile);
  store.saveProfiles(state.profiles);
}

// ---------- tabs ----------
const TABS = [
  ["employees", "Employees"],
  ["employer", "Employer & rates"],
  ["generate", "Generate forms"],
  ["privacy", "Privacy & data"],
];

function render() {
  app.replaceChildren(
    h(
      "header",
      { class: "app" },
      h("h1", {}, "CDASS Enroll"),
      h("span", { class: "badge" }, "100% local - nothing leaves this computer")
    ),
    h(
      "nav",
      { class: "tabs" },
      ...TABS.map(([id, label]) =>
        h(
          "button",
          {
            class: state.tab === id ? "active" : "",
            onclick: () => {
              state.tab = id;
              render();
            },
          },
          label
        )
      )
    ),
    { employees: renderEmployees, employer: renderEmployerTab, generate: renderGenerate, privacy: renderPrivacy }[
      state.tab
    ]()
  );
}

// ---------- Employees tab ----------
function renderEmployees() {
  const wrap = h("div");

  if (state.editingId) {
    const profile = state.profiles.find((p) => p.id === state.editingId);
    if (profile) return renderEditor(profile);
    state.editingId = null;
  }

  const list = h("ul", { class: "people" });
  if (state.profiles.length === 0) {
    list.append(h("li", {}, h("span", { class: "meta" }, "No employees yet. Add one to get started.")));
  }
  for (const p of state.profiles) {
    list.append(
      h(
        "li",
        {},
        h(
          "span",
          {
            class: "name",
            onclick: () => {
              state.editingId = p.id;
              render();
            },
          },
          displayName(p)
        ),
        h("span", { class: "meta" }, [p.city, p.state].filter(Boolean).join(", ")),
        h(
          "button",
          {
            class: "btn danger",
            onclick: () => {
              if (!confirm(`Delete ${displayName(p)} and all their data?`)) return;
              state.profiles = state.profiles.filter((x) => x.id !== p.id);
              store.saveProfiles(state.profiles);
              render();
            },
          },
          "Delete"
        )
      )
    );
  }

  wrap.append(
    h(
      "div",
      { class: "card" },
      h("h2", {}, "Employees"),
      list,
      h(
        "div",
        { class: "btnrow" },
        h(
          "button",
          {
            class: "btn primary",
            onclick: () => {
              const p = blankProfile();
              saveProfile(p);
              state.editingId = p.id;
              render();
            },
          },
          "+ Add employee"
        )
      )
    )
  );
  return wrap;
}

function renderEditor(profile) {
  const wrap = h("div");
  const status = h("div", { class: "status" });

  const setStatus = (cls, msg) => {
    status.className = "status " + cls;
    status.textContent = msg;
  };

  const formArea = renderSections(PROFILE_SECTIONS, profile, () => saveProfile(profile));

  async function handleScan(file, scanFn, label) {
    setStatus("busy", `Reading ${label} locally... (first OCR run takes a few seconds)`);
    try {
      const { fields, source } = await scanFn(file);
      const changed = new Set();
      for (const [k, v] of Object.entries(fields)) {
        if (k.endsWith("Unverified")) continue;
        if (profile[k] !== v) {
          profile[k] = v;
          changed.add(k);
        }
      }
      saveProfile(profile);
      refreshInputs(formArea, profile, changed);
      const warn = fields.passportNumberUnverified
        ? ` Passport number "${fields.passportNumberUnverified}" failed its check digit; verify it manually.`
        : "";
      setStatus(
        "ok",
        `${source}: filled ${changed.size} field${changed.size === 1 ? "" : "s"} (${[...changed].join(", ") || "none new"}). Review before generating.${warn}`
      );
    } catch (e) {
      setStatus("err", e.message);
    }
  }

  const scanButton = (label, hint, scanFn) => {
    const input = h("input", {
      type: "file",
      accept: "image/*",
      onchange: (e) => {
        const file = e.target.files[0];
        if (file) handleScan(file, scanFn, label);
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

  wrap.append(
    h(
      "div",
      { class: "card" },
      h("h2", {}, "Scan documents (processed on this computer only)"),
      h(
        "div",
        { class: "scanrow" },
        scanButton("Driver's license", "Photo of the BACK (the barcode)", scanLicense),
        scanButton("Passport", "Photo page, straight on", scanPassport),
        scanButton("Social Security card", "Front, well lit", scanSsnCard)
      ),
      status,
      h(
        "p",
        { class: "note" },
        "Images are decoded in this browser and are not stored. Extracted values are highlighted below; always double-check them."
      )
    ),
    formArea,
    h(
      "div",
      { class: "btnrow" },
      h(
        "button",
        {
          class: "btn primary",
          onclick: () => {
            state.editingId = null;
            render();
          },
        },
        "Done"
      ),
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            state.tab = "generate";
            state.genOptions.profileId = profile.id;
            render();
          },
        },
        "Go to Generate →"
      )
    )
  );

  return h(
    "div",
    {},
    h(
      "div",
      { class: "btnrow", style: "margin: 0 0 0.75rem" },
      h(
        "button",
        {
          class: "btn",
          onclick: () => {
            state.editingId = null;
            render();
          },
        },
        "← All employees"
      ),
      h("strong", { style: "align-self:center" }, displayName(profile))
    ),
    wrap
  );
}

// ---------- Employer tab ----------
function renderEmployerTab() {
  const wrap = h("div");
  wrap.append(
    h(
      "p",
      { class: "note" },
      "Entered once, used on every packet: the Member receiving care, the employer of record, and default pay rates."
    ),
    renderSections(EMPLOYER_SECTIONS, state.employer, () => store.saveEmployer(state.employer))
  );
  return wrap;
}

// ---------- Generate tab ----------
function renderGenerate() {
  const wrap = h("div");
  const opts = state.genOptions;
  const status = h("div", { class: "status" });

  if (!opts.profileId && state.profiles.length) opts.profileId = state.profiles[0].id;

  const profileSel = h(
    "select",
    { onchange: (e) => (opts.profileId = e.target.value) },
    ...state.profiles.map((p) => {
      const o = h("option", { value: p.id }, displayName(p));
      o.selected = opts.profileId === p.id;
      return o;
    })
  );

  const dateField = (label, key) => {
    const inp = h("input", { type: "date", value: opts[key] ?? "", oninput: (e) => (opts[key] = e.target.value) });
    return h("label", { class: "field" }, label, inp);
  };

  const packetCb = h("input", { type: "checkbox" });
  packetCb.checked = true;
  const w4Cb = h("input", { type: "checkbox" });
  w4Cb.checked = true;
  const newServiceCb = h("input", { type: "checkbox", onchange: (e) => (opts.newService = e.target.checked) });
  newServiceCb.checked = opts.newService;

  async function generate() {
    const profile = state.profiles.find((p) => p.id === opts.profileId);
    if (!profile) return setStatus("err", "Pick an employee first.");
    if (!packetCb.checked && !w4Cb.checked) return setStatus("err", "Select at least one form.");
    setStatus("busy", "Filling forms locally...");
    try {
      const stem = `${profile.last || "employee"}-${profile.first || ""}`.replace(/[^\w-]+/g, "");
      if (packetCb.checked) {
        const bytes = await fetchTemplate("forms/CO-CDASS-Attendant-Packet-2026.pdf");
        download(await fillPacket2026(bytes, profile, state.employer, opts), `${stem}-CDASS-packet-2026.pdf`);
      }
      if (w4Cb.checked) {
        const bytes = await fetchTemplate("forms/w4.pdf");
        download(await fillW4(bytes, profile, state.employer, opts), `${stem}-W4.pdf`);
      }
      setStatus("ok", "Done. Files are in your Downloads folder. Review every page, then sign and date by hand where required.");
    } catch (e) {
      console.error(e);
      setStatus("err", "Failed: " + e.message);
    }
  }

  const setStatus = (cls, msg) => {
    status.className = "status " + cls;
    status.textContent = msg;
  };

  wrap.append(
    h(
      "div",
      { class: "card" },
      h("h2", {}, "Generate filled forms"),
      h(
        "div",
        { class: "grid" },
        h("label", { class: "field" }, "Employee", profileSel),
        dateField("Signature date (printed on each form)", "signatureDate"),
        dateField("First day of employment (I-9 / W-4)", "firstDay"),
        dateField("Rate effective date", "rateEffectiveDate")
      ),
      h("h3", {}, "Forms to generate"),
      h("label", { class: "check" }, packetCb, "PPL CDASS Attendant Packet 2026 (enrollment, agreement, direct deposit, rates, tax exemptions, EVV exemption, I-9)"),
      h("label", { class: "check" }, w4Cb, "IRS W-4 withholding (2024 revision, as distributed by PPL)"),
      h("label", { class: "check" }, newServiceCb, "Rate form: this is a new service (uncheck for an hourly-rate change)"),
      h("div", { class: "btnrow" }, h("button", { class: "btn primary", onclick: generate }, "Generate & download")),
      status,
      h(
        "p",
        { class: "note" },
        "Signatures are never auto-filled. The packet's rehire page (Supplement B) shares a field with I-9 List A in the original PDF, so if a passport was used, ignore the mirrored title on that page."
      )
    )
  );
  return wrap;
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

// ---------- Privacy tab ----------
function renderPrivacy() {
  const fileInput = h("input", {
    type: "file",
    accept: ".json,application/json",
    style: "display:none",
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const n = store.importAll(await f.text());
        state.profiles = store.loadProfiles();
        state.employer = store.loadEmployer();
        alert(`Imported ${n} employee profile(s).`);
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
      "Employee profiles (including SSNs) are stored in this browser's local storage on this machine, unencrypted. Anyone who can log into this Windows account can read them, so use a locked account and consider BitLocker disk encryption. Generated PDFs go to your Downloads folder; store and dispose of them like any document containing an SSN."
    ),
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
        "Export all data (JSON)"
      ),
      h("button", { class: "btn", onclick: () => fileInput.click() }, "Import backup"),
      h(
        "button",
        {
          class: "btn danger",
          onclick: () => {
            if (!confirm("Permanently delete ALL employee profiles and employer settings from this browser?")) return;
            store.wipeAll();
            state.profiles = [];
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

render();
