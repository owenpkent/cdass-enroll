// All persistence is browser localStorage on this machine. Nothing leaves it.

import { blankEmployer } from "./schema.js";

const PROFILES_KEY = "cdass.profiles.v1";
const EMPLOYER_KEY = "cdass.employer.v1";

export function loadProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY)) ?? [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

export function loadEmployer() {
  try {
    return { ...blankEmployer(), ...JSON.parse(localStorage.getItem(EMPLOYER_KEY)) };
  } catch {
    return blankEmployer();
  }
}

export function saveEmployer(employer) {
  localStorage.setItem(EMPLOYER_KEY, JSON.stringify(employer));
}

export function wipeAll() {
  localStorage.removeItem(PROFILES_KEY);
  localStorage.removeItem(EMPLOYER_KEY);
}

export function exportAll() {
  return JSON.stringify(
    { exported: new Date().toISOString(), employer: loadEmployer(), profiles: loadProfiles() },
    null,
    2
  );
}

/**
 * Load public/seed.local.json (gitignored, same origin) into the employer
 * settings, but only when they are still empty, so a fresh browser profile
 * starts pre-filled without ever clobbering edits.
 */
export async function applySeedIfEmpty() {
  const current = loadEmployer();
  if (Object.values(current).some((v) => v)) return false;
  try {
    const res = await fetch(new URL("seed.local.json", document.baseURI), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return false;
    const seed = await res.json();
    if (!seed || typeof seed.employer !== "object") return false;
    const merged = { ...blankEmployer() };
    for (const k of Object.keys(merged)) if (seed.employer[k]) merged[k] = seed.employer[k];
    saveEmployer(merged);
    return true;
  } catch {
    return false;
  }
}

export function importAll(json) {
  const data = JSON.parse(json);
  if (!Array.isArray(data.profiles)) throw new Error("Not a valid export file");
  saveProfiles(data.profiles);
  if (data.employer) saveEmployer(data.employer);
  return data.profiles.length;
}
