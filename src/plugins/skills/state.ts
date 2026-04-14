/** In-memory set of active skill names — resets on restart */
let activeSkills = new Set<string>();

export function getActiveSkills(): Set<string> {
  return activeSkills;
}

export function isActive(name: string): boolean {
  return activeSkills.has(name);
}

/** Activate a skill. Returns true if newly activated, false if already active. */
export function activate(name: string): boolean {
  if (activeSkills.has(name)) return false;
  activeSkills.add(name);
  return true;
}

/** Deactivate a skill. Returns true if was active, false if wasn't. */
export function deactivate(name: string): boolean {
  if (!activeSkills.has(name)) return false;
  activeSkills.delete(name);
  return true;
}
