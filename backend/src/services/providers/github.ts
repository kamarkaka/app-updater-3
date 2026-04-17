import { Application } from "../../db/schema.js";
import { appConfig } from "../../config.js";
import { VersionProvider, VersionResult } from "./types.js";

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;

    // Handle: /owner/repo, /owner/repo/releases, /owner/repo/tags, etc.
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

function filterAssets(urls: string[], pattern?: string | null): string[] {
  if (!pattern) return urls;
  try {
    const regex = new RegExp(pattern, "i");
    return urls.filter((u) => regex.test(u));
  } catch {
    return urls;
  }
}

export const githubProvider: VersionProvider = {
  canHandle(url: string): boolean {
    return parseGitHubRepo(url) !== null;
  },

  async detect(app: Application): Promise<VersionResult> {
    const repo = parseGitHubRepo(app.url);
    if (!repo) throw new Error("Cannot parse GitHub URL");

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "app-updater/1.0",
    };
    if (appConfig.githubToken) {
      headers.Authorization = `Bearer ${appConfig.githubToken}`;
    }

    // Try releases first
    let data: any;
    let assets: string[] = [];

    const releaseRes = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`,
      { headers }
    );

    if (releaseRes.ok) {
      data = await releaseRes.json();
      assets = (data.assets || []).map((a: any) => a.browser_download_url);

      const version = (data.tag_name || "").replace(/^v/, "");
      return {
        version,
        downloadUrls: filterAssets(assets, app.assetPattern),
        publishedAt: data.published_at ? new Date(data.published_at) : undefined,
        changelog: data.body || undefined,
      };
    }

    // Fall back to tags
    const tagsRes = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/tags?per_page=1`,
      { headers }
    );

    if (!tagsRes.ok) {
      throw new Error(`GitHub API error: ${tagsRes.status} ${tagsRes.statusText}`);
    }

    const tags: any[] = await tagsRes.json();
    if (tags.length === 0) {
      throw new Error("No releases or tags found");
    }

    const version = (tags[0].name || "").replace(/^v/, "");
    // For tags, provide tarball/zipball as download URLs
    const tarball = `https://github.com/${repo.owner}/${repo.repo}/archive/refs/tags/${tags[0].name}.tar.gz`;
    const zipball = `https://github.com/${repo.owner}/${repo.repo}/archive/refs/tags/${tags[0].name}.zip`;

    return {
      version,
      downloadUrls: filterAssets([tarball, zipball], app.assetPattern),
    };
  },
};
