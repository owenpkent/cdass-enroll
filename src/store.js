// All persistence is browser localStorage on this machine. Nothing leaves it.

import { blankEmployer } from "./schema.js";

const PROFILES_KEY = "cdass.profiles.v1";
const EMPLOYER_KEY = "cdass.employer.v1";
const RETENTION_KEY = "cdass.retentionDays.v1";

export const RETENTION_CHOICES = [
  ["7", "7 days"],
  ["30", "30 days (default)"],
  ["90", "90 days"],
  ["never", "Keep until wiped manually"],
];

export function getRetentionDays() {
  const v = localStorage.getItem(RETENTION_KEY) ?? "30";
  return v === "never" ? null : Number(v);
}

export function setRetention(value) {
  localStorage.setItem(RETENTION_KEY, value);
}

export function getRetentionSetting() {
  return localStorage.getItem(RETENTION_KEY) ?? "30";
}

/**
 * Delete employee profiles untouched for longer than the retention period.
 * Employer settings are kept; they re-seed from seed.local.json anyway.
 * Returns the number of profiles removed.
 */
export function purgeStaleProfiles(now = Date.now()) {
  const days = getRetentionDays();
  if (days == null) return 0;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const profiles = loadProfiles();
  // Profiles saved before timestamps existed get stamped now (one grace period).
  for (const p of profiles) p.touchedAt ??= now;
  const kept = profiles.filter((p) => p.touchedAt >= cutoff);
  saveProfiles(kept);
  return profiles.length - kept.length;
}

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
