import matter from "gray-matter";
import path from "node:path";

import { getTemplate } from "../core/config.js";
import { EmbeddingClient } from "../core/embedding.js";
import { loadRuntimeConfig, openRuntimeDb } from "../core/runtime.js";
import type { LoadedWikiConfig } from "../types/config.js";
import { ensureDirSync, pathExistsSync, readTextFileSync, writeTextFileSync } from "../utils/fs.js";
import { AppError } from "../utils/errors.js";

export interface TypeDescriptor {
  pageType: string;
  file: string;
  filePath: string;
  columns: string[];
  edges: string[];
  summaryFields: string[];
}

interface SimilarPageHit {
  pageType: string;
  pageId: string;
  title: string;
  similarity: number;
}

export interface TypeRecommendOptions {
  text: string;
  keywords?: string;
  limit?: number | string;
}

export interface CreateTemplateOptions {
  type: string;
  title: string;
}

function distanceToSimilarity(distance: number): number {
  return 1 / (1 + distance);
}

function normalizeKeywords(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveLimit(value: number | string | undefined, label: string, fallback: number): number {
  const normalized = value ?? fallback;
  const limit = Number.parseInt(String(normalized), 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new AppError(`Invalid ${label} value: ${value}`, "config");
  }
  return limit;
}

function toTypeDescriptor(
  pageType: string,
  definition: LoadedWikiConfig["templates"][string],
  wikiRoot: string,
): TypeDescriptor {
  return {
    pageType,
    file: definition.file,
    filePath: path.resolve(wikiRoot, definition.file),
    columns: Object.keys(definition.columns),
    edges: Object.keys(definition.edges),
    summaryFields: definition.summaryFields,
  };
}

function templateSkeleton(pageType: string, title: string): string {
  return matter.stringify(
    [
      "## Summary",
      "",
      "- Add a concise overview.",
      "",
      "## Details",
      "",
      "- Expand the template fields and sections for this page type.",
    ].join("\n"),
    {
      pageType,
      title,
      nodeId: "",
      status: "draft",
      visibility: "private",
      sourceRefs: [],
      relatedPages: [],
      tags: [],
      createdAt: "2026-04-06",
      updatedAt: "2026-04-06",
    },
  );
}

export function listTypes(env: NodeJS.ProcessEnv = process.env): TypeDescriptor[] {
  const { paths, config } = loadRuntimeConfig(env);
  return Object.entries(config.templates)
    .map(([pageType, definition]) => toTypeDescriptor(pageType, definition, paths.wikiRoot))
    .sort((left, right) => left.pageType.localeCompare(right.pageType));
}

export function showType(env: NodeJS.ProcessEnv = process.env, pageType: string): Record<string, unknown> {
  const { paths, config } = loadRuntimeConfig(env);
  const definition = config.templates[pageType];
  if (!definition) {
    throw new AppError(`Unknown type: ${pageType}`, "not_found");
  }

  return {
    ...toTypeDescriptor(pageType, definition, paths.wikiRoot),
    columns: definition.columns,
    edges: definition.edges,
  };
}

export async function recommendTypes(
  env: NodeJS.ProcessEnv = process.env,
  options: TypeRecommendOptions,
): Promise<{
  query: { text: string; keywords: string[] };
  recommendations: Array<{
    pageType: string;
    score: number;
    signals: string[];
    similarPages: string[];
  }>;
}> {
  const embeddingClient = EmbeddingClient.fromEnv(env);
  if (!embeddingClient) {
    throw new AppError("Embedding not configured", "not_configured");
  }

  const limit = parsePositiveLimit(options.limit, "--limit", 5);
  const keywords = normalizeKeywords(options.keywords);
  const queryText = [options.text.trim(), keywords.length > 0 ? `keywords: ${keywords.join(", ")}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const [queryEmbedding] = await embeddingClient.embedBatch([queryText]);
  const neighborLimit = Math.max(limit * 8, 24);
  const { db } = openRuntimeDb(env);

  try {
    const hasVectors = (
      db.prepare("SELECT COUNT(*) AS count FROM vec_pages").get() as { count: number }
    ).count;
    if (hasVectors === 0) {
      throw new AppError("No page embeddings found. Run wiki sync with embedding enabled first.", "not_configured");
    }

    const rows = db
      .prepare(
        `
          SELECT
            pages.page_type AS pageType,
            pages.id AS pageId,
            pages.title AS title,
            vec_pages.distance AS distance
          FROM vec_pages
          JOIN pages ON pages.id = vec_pages.page_id
          WHERE vec_pages.embedding MATCH ?
            AND k = ?
          ORDER BY vec_pages.distance
          LIMIT ?
        `,
      )
      .all(new Float32Array(queryEmbedding), neighborLimit, neighborLimit) as Array<{
      pageType: string;
      pageId: string;
      title: string;
      distance: number;
    }>;

    if (rows.length === 0) {
      throw new AppError("No similar embedded pages found for type recommendation.", "runtime");
    }

    const grouped = new Map<
      string,
      {
        totalSimilarity: number;
        maxSimilarity: number;
        supportCount: number;
        hits: SimilarPageHit[];
      }
    >();

    for (const row of rows) {
      const similarity = distanceToSimilarity(Number(row.distance));
      const bucket = grouped.get(row.pageType) ?? {
        totalSimilarity: 0,
        maxSimilarity: 0,
        supportCount: 0,
        hits: [],
      };
      bucket.totalSimilarity += similarity;
      bucket.maxSimilarity = Math.max(bucket.maxSimilarity, similarity);
      bucket.supportCount += 1;
      bucket.hits.push({
        pageType: row.pageType,
        pageId: row.pageId,
        title: row.title,
        similarity,
      });
      grouped.set(row.pageType, bucket);
    }

    const recommendations = [...grouped.entries()]
      .map(([pageType, bucket]) => {
        const topHits = bucket.hits
          .sort((left, right) => right.similarity - left.similarity)
          .slice(0, 3);
        return {
          pageType,
          score: Number(bucket.totalSimilarity.toFixed(6)),
          signals: [
            `supportCount:${bucket.supportCount}`,
            `maxSimilarity:${bucket.maxSimilarity.toFixed(4)}`,
            `avgSimilarity:${(bucket.totalSimilarity / bucket.supportCount).toFixed(4)}`,
          ],
          similarPages: topHits.map((hit) => `${hit.pageId}@${hit.similarity.toFixed(4)}`),
        };
      })
      .sort((left, right) => right.score - left.score || left.pageType.localeCompare(right.pageType))
      .slice(0, limit);

    return {
      query: { text: options.text, keywords },
      recommendations,
    };
  } finally {
    db.close();
  }
}

export function listTemplates(env: NodeJS.ProcessEnv = process.env): Array<Record<string, unknown>> {
  const { paths, config } = loadRuntimeConfig(env);
  return Object.entries(config.templates).map(([pageType, definition]) => ({
    pageType,
    file: definition.file,
    filePath: path.resolve(paths.wikiRoot, definition.file),
  }));
}

export function showTemplate(env: NodeJS.ProcessEnv = process.env, pageType: string): Record<string, unknown> {
  const { paths, config } = loadRuntimeConfig(env);
  getTemplate(config, pageType);
  const filePath = path.resolve(paths.wikiRoot, config.templates[pageType].file);
  return {
    pageType,
    filePath,
    content: readTextFileSync(filePath),
  };
}

export function createTemplate(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateTemplateOptions,
): Record<string, unknown> {
  const { paths, config } = loadRuntimeConfig(env);
  if (config.templates[options.type]) {
    throw new AppError(`Template already exists: ${options.type}`, "config");
  }

  const templateRelativePath = path.join("templates", `${options.type}.md`).split(path.sep).join("/");
  const templatePath = path.resolve(paths.wikiRoot, templateRelativePath);
  ensureDirSync(path.dirname(templatePath));
  if (pathExistsSync(templatePath)) {
    throw new AppError(`Template file already exists: ${templatePath}`, "config");
  }

  writeTextFileSync(templatePath, templateSkeleton(options.type, options.title));

  const updatedConfig = {
    schemaVersion: config.schemaVersion,
    customColumns: config.customColumns,
    defaultSummaryFields: config.defaultSummaryFields,
    vaultFileTypes: config.vaultFileTypes,
    commonEdges: config.commonEdges,
    templates: {
      ...config.templates,
      [options.type]: {
        file: templateRelativePath,
        columns: {},
        edges: {},
        summaryFields: [],
      },
    },
  };

  writeTextFileSync(paths.configPath, `${JSON.stringify(updatedConfig, null, 2)}\n`);

  return {
    pageType: options.type,
    templatePath,
    configPath: paths.configPath,
  };
}
