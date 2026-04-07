import { afterEach, describe, expect, it } from "vitest";

import { buildVaultWorkflowPrompt, ensureWorkflowArtifactSet } from "../../src/core/workflow-context.js";
import { resolveRuntimePaths } from "../../src/core/paths.js";
import { cleanupWorkspace, createWorkspace, readFile } from "../helpers.js";

describe("workflow prompt shape", () => {
  const workspaces: ReturnType<typeof createWorkspace>[] = [];

  afterEach(() => {
    while (workspaces.length > 0) {
      cleanupWorkspace(workspaces.pop()!);
    }
  });

  it("guides runtime ontology discovery, type selection, and relation building", () => {
    const prompt = buildVaultWorkflowPrompt({
      workspaceRoot: "/tmp/workspace",
      vaultFilePath: "/tmp/workspace/vault/imports/spec.pdf",
      resultJsonPath: "/tmp/workspace/wiki/.queue-artifacts/spec/result.json",
      allowTemplateEvolution: false,
    });

    expect(prompt).toContain("WORKSPACE_ROOT=/tmp/workspace");
    expect(prompt).toContain("VAULT_FILE_PATH=/tmp/workspace/vault/imports/spec.pdf");
    expect(prompt).toContain("RESULT_JSON_PATH=/tmp/workspace/wiki/.queue-artifacts/spec/result.json");
    expect(prompt).toContain("ALLOW_TEMPLATE_EVOLUTION=false");
    expect(prompt).toContain("## Environment");
    expect(prompt).toContain("Workspace-local skills are available from WORKSPACE_ROOT");
    expect(prompt).toContain("wiki type list");
    expect(prompt).toContain("wiki template show <type>");
    expect(prompt).toContain("wiki page-info <pageId>");
    expect(prompt).toContain("## Step 1 — Read and Discover");
    expect(prompt).toContain("Discover the current page type ontology through the wiki CLI");
    expect(prompt).toContain("## Step 2 — Decide");
    expect(prompt).toContain("### Type Selection");
    expect(prompt).toContain("Do not default to any single type.");
    expect(prompt).toContain("### Splitting");
    expect(prompt).toContain("At most 5 pages per vault source");
    expect(prompt).toContain("### Building Relations");
    expect(prompt).toContain("Do not inspect the whole workspace");
    expect(prompt).toContain("Do not call wiki --help or perform broad discovery");
    expect(prompt).toContain("**vaultPath**: MUST be relative to the vault root");
    expect(prompt).toContain("**relatedPages**: Populate with page IDs of related pages");
    expect(prompt).toContain("The system will normalize them to YYYY-MM-DD during indexing");
    expect(prompt).toContain("If ALLOW_TEMPLATE_EVOLUTION=false, do not create templates or new page types.");
    expect(prompt).toContain("## Step 4 — Write Result Manifest");
    expect(prompt).toContain("The authoritative threadId is queue-item.json.threadId");
    expect(prompt).toContain("**status**: done | skipped | error");
    expect(prompt).toContain("**decision**: apply | skip | propose_only");
    expect(prompt).toContain("**actions**: Array of objects, never strings.");
    expect(prompt).toContain("Write raw JSON only, with no Markdown fences");
    expect(prompt).toContain("Stop immediately after RESULT_JSON_PATH is fully written.");
    expect(prompt).toContain("Write RESULT_JSON_PATH as one JSON object");
    expect(prompt).not.toContain("SKILL_PACKAGE_ROOT=");
    expect(prompt).not.toContain("defaulting to source-summary");
    expect(prompt).not.toContain("AGENTS.md");
  });

  it("writes the workflow guidance prompt to prompt.md artifacts", () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);
    const paths = resolveRuntimePaths(workspace.env);
    const prompt = buildVaultWorkflowPrompt({
      workspaceRoot: workspace.root,
      vaultFilePath: `${workspace.vaultPath}/imports/spec.pdf`,
      resultJsonPath: `${workspace.wikiRoot}/.queue-artifacts/spec/result.json`,
      allowTemplateEvolution: true,
    });

    const artifacts = ensureWorkflowArtifactSet(paths, {
      queueItemId: "imports/spec.pdf",
      queueItem: { fileId: "imports/spec.pdf" },
      promptMarkdown: prompt,
    });

    const savedPrompt = readFile(artifacts.promptPath);
    expect(savedPrompt).toContain(`WORKSPACE_ROOT=${workspace.root}`);
    expect(savedPrompt).toContain("ALLOW_TEMPLATE_EVOLUTION=true");
    expect(savedPrompt).toContain("wiki CLI provides these discovery and search capabilities");
    expect(savedPrompt).toContain("Workspace-local skills are available from WORKSPACE_ROOT");
    expect(savedPrompt).toContain("The system will normalize them to YYYY-MM-DD during indexing");
    expect(savedPrompt).toContain("queue-item.json.threadId");
    expect(savedPrompt).not.toContain("SKILL_PACKAGE_ROOT=");
  });
});
