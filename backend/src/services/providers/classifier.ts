export function classifySource(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "github.com" || u.hostname === "www.github.com") {
      return "github";
    }
    if (u.hostname === "gitlab.com" || u.hostname === "www.gitlab.com") {
      return "gitlab";
    }
    return "generic";
  } catch {
    return "generic";
  }
}
