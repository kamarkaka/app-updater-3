import semver from "semver";

function normalize(v: string): string {
  // Strip leading 'v' or 'V'
  let normalized = v.replace(/^[vV]/, "");
  // Pad to 3 parts if only 2 (e.g., "1.2" -> "1.2.0")
  const parts = normalized.split(".");
  while (parts.length < 3) {
    parts.push("0");
  }
  return parts.join(".");
}

/**
 * Compare two version strings.
 * Returns: positive if latest > current, 0 if equal, negative if latest < current.
 */
export function compareVersions(current: string, latest: string): number {
  if (current === latest) return 0;

  const normCurrent = normalize(current);
  const normLatest = normalize(latest);

  // Try semver comparison first
  const semCurrent = semver.valid(semver.coerce(normCurrent));
  const semLatest = semver.valid(semver.coerce(normLatest));

  if (semCurrent && semLatest) {
    return semver.compare(semLatest, semCurrent);
  }

  // Fallback: locale comparison
  return normLatest.localeCompare(normCurrent, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function isNewer(current: string | null, latest: string): boolean {
  if (!current) return true;
  return compareVersions(current, latest) > 0;
}
