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

export function importAll(json) {
  const data = JSON.parse(json);
  if (!Array.isArray(data.profiles)) throw new Error("Not a valid export file");
  saveProfiles(data.profiles);
  if (data.employer) saveEmployer(data.employer);
  return data.profiles.length;
}
