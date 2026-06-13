// All persistence is browser localStorage on this machine. Nothing leaves it.

import { blankEmployer, blankProfile } from "./schema.js";

const PROFILE_KEY = "cdass.profile.v1";
const LEGACY_PROFILES_KEY = "cdass.profiles.v1"; // pre-simplification array of people
const EMPLOYER_KEY = "cdass.employer.v1";
const RETENTION_KEY = "cdass.retentionDays.v1";

export const RETENTION_CHOICES = [
  ["7", "7 days"],
  ["30", "30 days (default)"],
  ["90", "90 days"],
  ["never", "Keep until cleared manually"],
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
 * The single person currently being enrolled. The first time this runs after
 * the multi-profile simplification, it migrates the most recently touched
 * person out of the old array so existing data is not lost.
 */
export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (p && typeof p === "object") return { ...blankProfile(), ...p };
  } catch {
    /* fall through */
  }
  const legacy = mostRecentLegacy();
  if (legacy) return { ...blankProfile(), ...legacy };
  return blankProfile();
}

function mostRecentLegacy() {
  try {
    const arr = JSON.parse(localStorage.getItem(LEGACY_PROFILES_KEY));
    if (Array.isArray(arr) && arr.length)
      return [...arr].sort((a, b) => (b.touchedAt ?? 0) - (a.touchedAt ?? 0))[0];
  } catch {
    /* none */
  }
  return null;
}

export function saveProfile(profile) {
  profile.touchedAt = Date.now();
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearProfile() {
  localStorage.removeItem(PROFILE_KEY);
}

/**
 * Clear the stored person if untouched longer than the retention period.
 * Returns true if it was cleared.
 */
export function purgeStaleProfile(now = Date.now()) {
  const days = getRetentionDays();
  if (days == null) return false;
  let p;
  try {
    p = JSON.parse(localStorage.getItem(PROFILE_KEY)) ?? mostRecentLegacy();
  } catch {
    return false;
  }
  if (!p) return false;
  const touched = p.touchedAt ?? now; // profiles without a timestamp get one grace period
  if (touched < now - days * 24 * 60 * 60 * 1000) {
    clearProfile();
    return true;
  }
  return false;
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
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(LEGACY_PROFILES_KEY);
  localStorage.removeItem(EMPLOYER_KEY);
}

export function exportAll() {
  return JSON.stringify(
    { exported: new Date().toISOString(), employer: loadEmployer(), profile: loadProfile() },
    null,
    2
  );
}

/**
 * Load public/seed.local.json (gitignored, same origin) into the standing
 * details, but only when they are still empty, so a fresh browser profile
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

/**
 * Import a backup. Accepts the current single-profile shape ({profile}) and
 * the legacy multi-profile shape ({profiles:[...]}, taking the most recent).
 */
export function importAll(json) {
  const data = JSON.parse(json);
  let profile = null;
  if (data.profile && typeof data.profile === "object") profile = data.profile;
  else if (Array.isArray(data.profiles) && data.profiles.length)
    profile = [...data.profiles].sort((a, b) => (b.touchedAt ?? 0) - (a.touchedAt ?? 0))[0];
  if (!profile && !data.employer) throw new Error("Not a valid export file");
  if (profile) saveProfile(profile);
  if (data.employer) saveEmployer(data.employer);
  return profile ? 1 : 0;
}
