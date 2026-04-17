import { Application } from "../../db/schema.js";

export interface VersionResult {
  version: string;
  downloadUrls: string[];
  publishedAt?: Date;
  changelog?: string;
}

export interface VersionProvider {
  canHandle(url: string): boolean;
  detect(app: Application): Promise<VersionResult>;
}
