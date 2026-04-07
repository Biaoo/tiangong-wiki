import { chmodSync } from "node:fs";
import path from "node:path";

import type { RuntimePaths } from "../types/page.js";
import { ensureDirSync, writeTextFileSync } from "../utils/fs.js";
import { sha256Text } from "../utils/fs.js";

export interface WorkflowArtifactSet {
  queueItemId: string;
  artifactId: string;
  rootDir: string;
  queueItemPath: string;
  promptPath: string;
  resultPath: string;
  skillArtifactsPath: string;
}

export interface VaultWorkflowPromptInput {
  workspaceRoot: string;
  vaultFilePath: string;
  resultJsonPath: string;
  allowTemplateEvolution: boolean;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveNodeExecutable(): string {
  const currentExec = path.basename(process.execPath).toLowerCase();
  if (currentExec === "node" || currentExec.startsWith("node")) {
    return process.execPath;
  }

  const npmNodeExecPath = process.env.npm_node_execpath?.trim();
  if (npmNodeExecPath) {
    return npmNodeExecPath;
  }

  return "node";
}

function readableArtifactPrefix(queueItemId: string): string {
  const normalized = queueItemId
    .replace(/[\\/]+/g, "__")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    return "queue-item";
  }
  return normalized.slice(0, 80);
}

export function toWorkflowArtifactId(queueItemId: string): string {
  return `${readableArtifactPrefix(queueItemId)}--${sha256Text(queueItemId).slice(0, 12)}`;
}

export function getWorkflowArtifactSet(paths: RuntimePaths, queueItemId: string): WorkflowArtifactSet {
  const artifactId = toWorkflowArtifactId(queueItemId);
  const rootDir = path.join(paths.queueArtifactsPath, artifactId);
  return {
    queueItemId,
    artifactId,
    rootDir,
    queueItemPath: path.join(rootDir, "queue-item.json"),
    promptPath: path.join(rootDir, "prompt.md"),
    resultPath: path.join(rootDir, "result.json"),
    skillArtifactsPath: path.join(rootDir, "skill-artifacts"),
  };
}

export function buildVaultWorkflowPrompt(input: VaultWorkflowPromptInput): string {
  return [
    "Process one vault queue item.",
    "",
    `WORKSPACE_ROOT=${input.workspaceRoot}`,
    `VAULT_FILE_PATH=${input.vaultFilePath}`,
    `RESULT_JSON_PATH=${input.resultJsonPath}`,
    `ALLOW_TEMPLATE_EVOLUTION=${input.allowTemplateEvolution ? "true" : "false"}`,
    "",
    "## Environment",
    "",
    "Workspace-local skills are available from WORKSPACE_ROOT through normal Codex skill discovery.",
    "A local wiki CLI launcher is already available on PATH for this run.",
    "",
    "The wiki CLI provides these discovery and search capabilities:",
    "- `wiki type list` / `wiki type show <type>` — discover registered page types and their purpose",
    "- `wiki template show <type>` — see the exact frontmatter fields and body structure for a type",
    "- `wiki find [options]` — find pages by structured metadata filters",
    "- `wiki search <query>` — semantic search over page summary embeddings",
    "- `wiki fts <query>` — full-text search over title, tags, and summary",
    "- `wiki list [options]` — list existing wiki pages",
    "- `wiki page-info <pageId>` — show full metadata and edges for one page",
    "- `wiki graph <root>` — traverse the wiki knowledge graph",
    "- `wiki stat` — show aggregate wiki index statistics",
    "",
    "Use whichever combination you judge necessary. These are tools at your disposal, not a mandatory checklist.",
    "",
    "## Step 1 — Read and Discover",
    "",
    "1. Read queue-item.json next to RESULT_JSON_PATH.",
    "2. Read the target vault file at VAULT_FILE_PATH.",
    "3. Discover the current page type ontology through the wiki CLI. Do not assume any type, template, or default target type.",
    "4. Understand the existing wiki knowledge landscape before deciding what to create or update:",
    "   - What pages already exist? Are any of them covering the same or overlapping topics?",
    "   - What is the current knowledge graph structure? Are there clusters of related pages that this new source naturally connects to?",
    "   - Does this source introduce genuinely new knowledge, or does it reinforce, extend, or contradict something already captured?",
    "",
    "These questions must be answered before proceeding to Step 2.",
    "",
    "Keep the run narrowly focused on the target vault file, the current ontology, and the best candidate pages.",
    "Do not inspect the whole workspace, list broad file trees, or read large reference files unless a concrete command failure blocks you.",
    "Do not call wiki --help or perform broad discovery unless a specific command failure forces it.",
    "",
    "## Step 2 — Decide",
    "",
    "### Type Selection",
    "",
    "Choose the page type that best matches the nature of the knowledge in the source. Query the registered types and understand their intended use before deciding. Do not default to any single type.",
    "",
    "### Update vs Create",
    "",
    "If an existing page already covers the same topic, prefer updating it over creating a duplicate. Only create a new page when the source introduces a genuinely new topic not yet represented in the wiki.",
    "",
    "### Splitting",
    "",
    "A single vault source MAY produce multiple pages of different types when the source contains independently reusable knowledge points.",
    "- At most 5 pages per vault source to avoid over-fragmentation.",
    "- Link all pages created from the same source via relatedPages.",
    "",
    "### Building Relations",
    "",
    "Every page you create or update should be connected to the existing knowledge graph where meaningful relations exist. Orphan pages with no relations are acceptable only when the source introduces a topic with no overlap to existing wiki content.",
    "",
    "## Step 3 — Create or Update Pages",
    "",
    "### Field Conventions",
    "",
    "- **vaultPath**: MUST be relative to the vault root. Never use absolute paths. Derive it by stripping the vault root prefix from VAULT_FILE_PATH.",
    "- **sourceRefs**: Prefer existing wiki page IDs when the new page directly builds on already-indexed wiki pages. Do not put absolute vault paths into sourceRefs. If no existing wiki page is directly referenced, it is acceptable to leave sourceRefs empty.",
    "- **relatedPages**: Populate with page IDs of related pages discovered in Step 1. Every page should have relations when related content exists in the wiki.",
    "- **createdAt / updatedAt**: Leave placeholders unchanged or omit them. The system will normalize them to YYYY-MM-DD during indexing and refresh updatedAt on modified pages.",
    "- **nodeId**: Use a lowercase kebab-case slug derived from the title.",
    "",
    "Consult the template for your chosen type before writing a page.",
    "If ALLOW_TEMPLATE_EVOLUTION=false, do not create templates or new page types.",
    "",
    "### Quality Gate",
    "",
    "For every changed page, run:",
    "1. `wiki sync --path <page>`",
    "2. `wiki lint --path <page> --format json`",
    "",
    "Fix any errors before proceeding. Warnings are acceptable.",
    "",
    "## Step 4 — Write Result Manifest",
    "",
    "The authoritative threadId is queue-item.json.threadId. Read it from there and copy it unchanged into result.json.threadId. If it is empty on first read, read queue-item.json again immediately before writing the manifest.",
    "",
    "Write RESULT_JSON_PATH as one JSON object with: status, decision, reason, threadId, skillsUsed, createdPageIds, updatedPageIds, appliedTypeNames, proposedTypes, actions, lint.",
    "",
    "### Allowed Values",
    "",
    "- **status**: done | skipped | error. Use done for successful apply or propose_only runs, skipped for skip, and error only when the workflow itself failed. Never use success, completed, failed, or other aliases.",
    "- **decision**: apply | skip | propose_only. Never use update_existing, create_new, update, create, or other aliases.",
    "- **actions**: Array of objects, never strings. Allowed action kinds: create_page, update_page, create_template. Every action object must include kind and summary. create_page requires pageType and title. update_page requires pageId. create_template requires pageType and title.",
    "- **proposedTypes**: Objects with name, reason, suggestedTemplateSections.",
    "- **lint**: Objects with pageId, errors, warnings.",
    "",
    "### Example",
    "",
    '{"status":"done","decision":"apply","reason":"Updated the existing method.","threadId":"<copy queue-item.json.threadId>","skillsUsed":["wiki-skill"],"createdPageIds":[],"updatedPageIds":["methods/example.md"],"appliedTypeNames":["method"],"proposedTypes":[],"actions":[{"kind":"update_page","pageId":"methods/example.md","pageType":"method","summary":"Updated the page with durable knowledge."}],"lint":[{"pageId":"methods/example.md","errors":0,"warnings":0}]}',
    "",
    "If no page change is justified, still write RESULT_JSON_PATH with decision=skip or decision=propose_only and then stop.",
    "Use RESULT_JSON_PATH only for the final structured manifest. Write raw JSON only, with no Markdown fences and no prose before or after the JSON object.",
    "The queue item metadata is stored next to RESULT_JSON_PATH as queue-item.json.",
    "Stop immediately after RESULT_JSON_PATH is fully written.",
  ].join("\n");
}

export function ensureWorkflowArtifactSet(
  paths: RuntimePaths,
  input: {
    queueItemId: string;
    queueItem: Record<string, unknown>;
    promptMarkdown?: string;
  },
): WorkflowArtifactSet {
  const artifacts = getWorkflowArtifactSet(paths, input.queueItemId);
  ensureDirSync(paths.queueArtifactsPath);
  ensureDirSync(artifacts.rootDir);
  ensureDirSync(artifacts.skillArtifactsPath);

  const wikiCliWrapperPath = path.join(artifacts.skillArtifactsPath, "wiki");
  const nodeExecutable = resolveNodeExecutable();
  const cliEntrypoint = path.join(paths.packageRoot, "dist", "index.js");
  writeTextFileSync(artifacts.queueItemPath, `${JSON.stringify(input.queueItem, null, 2)}\n`);
  writeTextFileSync(
    wikiCliWrapperPath,
    [
      "#!/bin/sh",
      'node_bin=${WIKI_CLI_NODE:-}',
      'if [ -z "$node_bin" ]; then',
      `  node_bin=${shellSingleQuote(nodeExecutable)}`,
      "fi",
      'cli_entry=${WIKI_CLI_ENTRYPOINT:-}',
      'if [ -z "$cli_entry" ]; then',
      `  cli_entry=${shellSingleQuote(cliEntrypoint)}`,
      "fi",
      'if [ ! -f "$cli_entry" ]; then',
      '  echo "wiki CLI entrypoint not found: ${cli_entry}" >&2',
      "  exit 127",
      "fi",
      'exec "$node_bin" "$cli_entry" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(wikiCliWrapperPath, 0o755);
  writeTextFileSync(
    artifacts.promptPath,
    input.promptMarkdown ??
      [
        "# Vault To Wiki Workflow",
        "",
        "This prompt is intentionally minimal and will be populated by the workflow runner.",
      ].join("\n"),
  );
  writeTextFileSync(artifacts.resultPath, "");

  return artifacts;
}
