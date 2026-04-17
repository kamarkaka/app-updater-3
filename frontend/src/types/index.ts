export interface Application {
  id: number;
  name: string;
  url: string;
  sourceType: string;
  currentVersion: string | null;
  latestVersion: string | null;
  lastCheckedAt: string | null;
  checkIntervalMinutes: number | null;
  status: string;
  errorMessage: string | null;
  nameFilter: string | null;
  versionSelector: string | null;
  versionPattern: string | null;
  downloadSelector: string | null;
  downloadPattern: string | null;
  assetPattern: string | null;
  maxNavigationDepth: number | null;
  downloadTimeout: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Download {
  id: number;
  applicationId: number;
  version: string;
  url: string;
  fileName: string;
  filePath: string | null;
  totalBytes: number | null;
  downloadedBytes: number | null;
  status: string;
  errorMessage: string | null;
  checksum: string | null;
  checksumType: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AppWithDownloads extends Application {
  downloads: Download[];
}

export interface CheckResult {
  version: string;
  hasUpdate: boolean;
  downloadUrls: string[];
  changelog?: string;
}

export interface Settings {
  checkIntervalMinutes: number;
  maxConcurrentDownloads: number;
  downloadDir: string;
}
