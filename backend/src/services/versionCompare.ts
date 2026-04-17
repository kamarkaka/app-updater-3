import semver from "semver";

/**
 * Compare two version strings.
 * Returns: positive if latest > current, 0 if equal, negative if latest < current.
 */
export function compareVersions(current: string, latest: string): number {
  if (current === latest) return 0;

  const semCurrent = semver.coerce(current);
  const semLatest = semver.coerce(latest);

  if (semCurrent && semLatest) {
    return semver.compare(semLatest, semCurrent);
  }

  // Fallback: locale comparison with numeric sorting
  return latest.localeCompare(current, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function isNewer(current: string | null, latest: string): boolean {
  if (!current) return true;
  return compareVersions(current, latest) > 0;
}
