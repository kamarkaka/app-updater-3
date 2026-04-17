import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { applications, Application } from "../db/schema.js";
import { githubProvider } from "./providers/github.js";
import { genericProvider } from "./providers/generic.js";
import { VersionProvider, VersionResult } from "./providers/types.js";
import { isNewer } from "./versionCompare.js";

const providers: VersionProvider[] = [githubProvider, genericProvider];

function getProvider(app: Application): VersionProvider {
  if (app.sourceType === "github") return githubProvider;
  if (app.sourceType === "generic") return genericProvider;

  // Auto-detect
  for (const provider of providers) {
    if (provider.canHandle(app.url)) return provider;
  }

  return genericProvider;
}

export interface CheckResult {
  version: string;
  hasUpdate: boolean;
  downloadUrls: string[];
  changelog?: string;
}

// Store latest detection results for download queuing
const latestResults = new Map<number, VersionResult>();

export function getLatestResult(appId: number): VersionResult | undefined {
  return latestResults.get(appId);
}

export async function checkAppForUpdates(app: Application): Promise<CheckResult> {
  const provider = getProvider(app);
  const result = await provider.detect(app);

  latestResults.set(app.id, result);

  const hasUpdate = isNewer(app.currentVersion, result.version);

  // Update application record
  db.update(applications)
    .set({
      latestVersion: result.version,
      lastCheckedAt: new Date(),
      status: "active",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, app.id))
    .run();

  return {
    version: result.version,
    hasUpdate,
    downloadUrls: result.downloadUrls,
    changelog: result.changelog,
  };
}
