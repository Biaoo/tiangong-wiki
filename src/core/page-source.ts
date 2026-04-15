import { parsePage } from "./frontmatter.js";
import { normalizePageId, resolvePagePath } from "./paths.js";
import type { LoadedWikiConfig } from "../types/config.js";
import { pathExistsSync, readTextFileSync, sha256Text } from "../utils/fs.js";

export interface CanonicalPageSource {
  pageId: string;
  pagePath: string;
  rawMarkdown: string | null;
  frontmatter: Record<string, unknown>;
  revision: string | null;
}

export function buildPageRevision(rawMarkdown: string | null): string | null {
  if (rawMarkdown === null) {
    return null;
  }
  return sha256Text(rawMarkdown);
}

export function readCanonicalPageSource(
  filePath: string,
  wikiPath: string,
  config: LoadedWikiConfig,
): CanonicalPageSource {
  const pageId = normalizePageId(filePath, wikiPath);
  const rawMarkdown = pathExistsSync(filePath) ? readTextFileSync(filePath) : null;
  const parsed = rawMarkdown === null ? null : parsePage(filePath, wikiPath, config);

  return {
    pageId,
    pagePath: filePath,
    rawMarkdown,
    frontmatter: parsed?.ok ? parsed.parsed.rawData : {},
    revision: buildPageRevision(rawMarkdown),
  };
}

export function readCanonicalPageSourceById(
  pageId: string,
  wikiPath: string,
  config: LoadedWikiConfig,
): CanonicalPageSource {
  const canonicalPageId = normalizePageId(pageId, wikiPath);
  return readCanonicalPageSource(resolvePagePath(canonicalPageId, wikiPath), wikiPath, config);
}
