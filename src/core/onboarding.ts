import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { DEFAULT_WIKI_ENV_FILE, getCliEnvironmentInfo, parseEnvFile, serializeEnvEntries } from "./cli-env.js";
import { resolveTemplateFilePath, loadConfig } from "./config.js";
import { EmbeddingClient } from "./embedding.js";
import { resolveAgentSettings } from "./paths.js";
import { scaffoldWorkspaceAssets } from "./workspace-bootstrap.js";
import { AppError } from "../utils/errors.js";
import { pathExistsSync, writeTextFileSync } from "../utils/fs.js";

export type DoctorSeverity = "ok" | "warn" | "error";

export interface DoctorCheck {
  id: string;
  severity: DoctorSeverity;
  summary: string;
  recommendation?: string;
}

export interface DoctorReport {
  ok: boolean;
  summary: {
    ok: number;
    warn: number;
    error: number;
  };
  envFile: {
    requestedPath: string | null;
    loadedPath: string | null;
    autoDiscovered: boolean;
    missingRequestedPath: boolean;
  };
  effectivePaths: {
    wikiPath: string | null;
    vaultPath: string | null;
    dbPath: string | null;
    configPath: string | null;
    templatesPath: string | null;
  };
  checks: DoctorCheck[];
  recommendations: string[];
}

interface SetupValues {
  envFilePath: string;
  wikiPath: string;
  vaultPath: string;
  dbPath: string;
  configPath: string;
  templatesPath: string;
  syncInterval: string;
  embeddingEnabled: boolean;
  embeddingBaseUrl: string | null;
  embeddingApiKey: string | null;
  embeddingModel: string | null;
  embeddingDimensions: string | null;
  agentEnabled: boolean;
  agentBaseUrl: string | null;
  agentApiKey: string | null;
  agentModel: string | null;
  agentBatchSize: string | null;
}

export interface SetupResult {
  envFilePath: string;
  createdDirectories: string[];
  copiedConfig: boolean;
  copiedTemplates: number;
  embeddingEnabled: boolean;
  agentEnabled: boolean;
}

interface PromptContext {
  cwd: string;
  output: NodeJS.WritableStream;
}

interface PromptDriver {
  ask(prompt: string): Promise<string>;
  close(): void;
}

const MANAGED_ENV_KEYS = new Set([
  "WIKI_PATH",
  "VAULT_PATH",
  "WIKI_DB_PATH",
  "WIKI_CONFIG_PATH",
  "WIKI_TEMPLATES_PATH",
  "WIKI_SYNC_INTERVAL",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_API_KEY",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "WIKI_AGENT_ENABLED",
  "WIKI_AGENT_BASE_URL",
  "WIKI_AGENT_API_KEY",
  "WIKI_AGENT_MODEL",
  "WIKI_AGENT_BATCH_SIZE",
]);

function writeSection(output: NodeJS.WritableStream, title: string): void {
  output.write(`\n${title}\n`);
}

function resolveInputPath(value: string, cwd: string): string {
  return path.resolve(cwd, value.trim());
}

function validateNonNegativeInteger(rawValue: string, label: string): string | null {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return `${label} must be a non-negative integer.`;
  }

  return null;
}

function validateUrl(rawValue: string, label: string): string | null {
  const value = rawValue.trim();
  if (!/^https?:\/\//i.test(value)) {
    return `${label} must start with http:// or https://.`;
  }

  return null;
}

function validateWikiPath(rawValue: string): string | null {
  const normalized = rawValue.replace(/[\\/]+$/g, "");
  if (!normalized.endsWith("/pages") && !normalized.endsWith("\\pages")) {
    return "WIKI_PATH must point to the wiki/pages directory.";
  }

  return null;
}

class ReadlinePromptDriver implements PromptDriver {
  constructor(private readonly rl: ReturnType<typeof createInterface>) {}

  ask(prompt: string): Promise<string> {
    return this.rl.question(prompt);
  }

  close(): void {
    this.rl.close();
  }
}

class BufferedPromptDriver implements PromptDriver {
  private index = 0;

  constructor(
    private readonly answers: string[],
    private readonly output: NodeJS.WritableStream,
  ) {}

  async ask(prompt: string): Promise<string> {
    const answer = this.answers[this.index] ?? "";
    this.index += 1;
    this.output.write(`${prompt}${answer}\n`);
    return answer;
  }

  close(): void {}
}

async function readBufferedAnswers(input: NodeJS.ReadableStream): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    return [];
  }

  return raw.split(/\r?\n/);
}

async function createPromptDriver(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<PromptDriver> {
  if ("isTTY" in input && input.isTTY) {
    return new ReadlinePromptDriver(
      createInterface({
        input,
        output,
      }),
    );
  }

  return new BufferedPromptDriver(await readBufferedAnswers(input), output);
}

async function promptText(
  driver: PromptDriver,
  ctx: PromptContext,
  label: string,
  defaultValue: string,
  options: {
    required?: boolean;
    validator?: (value: string) => string | null;
    normalize?: (value: string) => string;
  } = {},
): Promise<string> {
  while (true) {
    const answer = await driver.ask(`${label} [${defaultValue}]: `);
    const candidate = (answer.trim() || defaultValue).trim();

    if (options.required !== false && candidate.length === 0) {
      ctx.output.write(`${label} is required.\n`);
      continue;
    }

    const error = options.validator?.(candidate);
    if (error) {
      ctx.output.write(`${error}\n`);
      continue;
    }

    return options.normalize ? options.normalize(candidate) : candidate;
  }
}

async function promptYesNo(
  driver: PromptDriver,
  ctx: PromptContext,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? "Y/n" : "y/N";

  while (true) {
    const answer = (await driver.ask(`${label} [${suffix}]: `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    if (["y", "yes"].includes(answer)) {
      return true;
    }
    if (["n", "no"].includes(answer)) {
      return false;
    }
    ctx.output.write("Please answer yes or no.\n");
  }
}

function canReadWrite(targetPath: string): boolean {
  accessSync(targetPath, constants.R_OK | constants.W_OK);
  return true;
}

function canWrite(targetPath: string): boolean {
  accessSync(targetPath, constants.W_OK);
  return true;
}

function collectDoctorCheck(
  checks: DoctorCheck[],
  severity: DoctorSeverity,
  id: string,
  summary: string,
  recommendation?: string,
): void {
  checks.push({ id, severity, summary, ...(recommendation ? { recommendation } : {}) });
}

function getPathDefaults(env: NodeJS.ProcessEnv, cwd: string): SetupValues {
  const wikiRoot = env.WIKI_PATH ? path.resolve(env.WIKI_PATH, "..") : path.join(cwd, "wiki");
  const wikiPath = env.WIKI_PATH ? path.resolve(env.WIKI_PATH) : path.join(wikiRoot, "pages");
  const vaultPath = env.VAULT_PATH ? path.resolve(env.VAULT_PATH) : path.join(cwd, "vault");
  const dbPath = env.WIKI_DB_PATH ? path.resolve(env.WIKI_DB_PATH) : path.join(wikiRoot, "index.db");
  const configPath = env.WIKI_CONFIG_PATH ? path.resolve(env.WIKI_CONFIG_PATH) : path.join(wikiRoot, "wiki.config.json");
  const templatesPath = env.WIKI_TEMPLATES_PATH ? path.resolve(env.WIKI_TEMPLATES_PATH) : path.join(wikiRoot, "templates");

  return {
    envFilePath: env.WIKI_ENV_FILE ? path.resolve(cwd, env.WIKI_ENV_FILE) : path.join(cwd, DEFAULT_WIKI_ENV_FILE),
    wikiPath,
    vaultPath,
    dbPath,
    configPath,
    templatesPath,
    syncInterval: env.WIKI_SYNC_INTERVAL ?? "86400",
    embeddingEnabled: Boolean((env.EMBEDDING_BASE_URL ?? env.OPENROUTER_BASE_URL) && (env.EMBEDDING_API_KEY ?? env.OPENROUTER_API_KEY) && (env.EMBEDDING_MODEL ?? env.OPENROUTER_EMBEDDING_MODEL)),
    embeddingBaseUrl: env.EMBEDDING_BASE_URL ?? env.OPENROUTER_BASE_URL ?? "https://api.openai.com/v1",
    embeddingApiKey: env.EMBEDDING_API_KEY ?? env.OPENROUTER_API_KEY ?? null,
    embeddingModel: env.EMBEDDING_MODEL ?? env.OPENROUTER_EMBEDDING_MODEL ?? "text-embedding-3-small",
    embeddingDimensions: env.EMBEDDING_DIMENSIONS ?? "384",
    agentEnabled: (env.WIKI_AGENT_ENABLED ?? "").trim().toLowerCase() === "true",
    agentBaseUrl: env.WIKI_AGENT_BASE_URL ?? "https://api.openai.com/v1",
    agentApiKey: env.WIKI_AGENT_API_KEY ?? null,
    agentModel: env.WIKI_AGENT_MODEL ?? null,
    agentBatchSize: env.WIKI_AGENT_BATCH_SIZE ?? "5",
  };
}

async function collectEmbeddingSettings(
  driver: PromptDriver,
  ctx: PromptContext,
  defaults: SetupValues,
  env: NodeJS.ProcessEnv,
): Promise<Pick<SetupValues, "embeddingEnabled" | "embeddingBaseUrl" | "embeddingApiKey" | "embeddingModel" | "embeddingDimensions">> {
  const enabled = await promptYesNo(driver, ctx, "Enable semantic search with embeddings?", defaults.embeddingEnabled);
  if (!enabled) {
    return {
      embeddingEnabled: false,
      embeddingBaseUrl: null,
      embeddingApiKey: null,
      embeddingModel: null,
      embeddingDimensions: null,
    };
  }

  while (true) {
    const embeddingBaseUrl = await promptText(
      driver,
      ctx,
      "EMBEDDING_BASE_URL",
      defaults.embeddingBaseUrl ?? "https://api.openai.com/v1",
      { validator: (value) => validateUrl(value, "EMBEDDING_BASE_URL") },
    );
    const embeddingApiKey = await promptText(
      driver,
      ctx,
      "EMBEDDING_API_KEY",
      defaults.embeddingApiKey ?? "",
      { required: true },
    );
    const embeddingModel = await promptText(
      driver,
      ctx,
      "EMBEDDING_MODEL",
      defaults.embeddingModel ?? "text-embedding-3-small",
      { required: true },
    );
    const embeddingDimensions = await promptText(
      driver,
      ctx,
      "EMBEDDING_DIMENSIONS",
      defaults.embeddingDimensions ?? "384",
      { validator: (value) => validateNonNegativeInteger(value, "EMBEDDING_DIMENSIONS") },
    );

    const shouldProbe = await promptYesNo(driver, ctx, "Probe the embedding endpoint now?", false);
    if (shouldProbe) {
      try {
        const probeEnv = {
          ...env,
          EMBEDDING_BASE_URL: embeddingBaseUrl,
          EMBEDDING_API_KEY: embeddingApiKey,
          EMBEDDING_MODEL: embeddingModel,
          EMBEDDING_DIMENSIONS: embeddingDimensions,
        };
        const client = EmbeddingClient.fromEnv(probeEnv);
        if (!client) {
          throw new AppError("Embedding configuration is incomplete.", "config");
        }
        await client.probe();
        ctx.output.write("Embedding probe succeeded.\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.output.write(`Embedding probe failed: ${message}\n`);
        if (await promptYesNo(driver, ctx, "Re-enter embedding settings?", true)) {
          continue;
        }
      }
    }

    return {
      embeddingEnabled: true,
      embeddingBaseUrl,
      embeddingApiKey,
      embeddingModel,
      embeddingDimensions,
    };
  }
}

async function collectAgentSettings(
  driver: PromptDriver,
  ctx: PromptContext,
  defaults: SetupValues,
): Promise<Pick<SetupValues, "agentEnabled" | "agentBaseUrl" | "agentApiKey" | "agentModel" | "agentBatchSize">> {
  const enabled = await promptYesNo(
    driver,
    ctx,
    "Enable automatic vault-to-wiki processing?",
    defaults.agentEnabled,
  );
  if (!enabled) {
    return {
      agentEnabled: false,
      agentBaseUrl: null,
      agentApiKey: null,
      agentModel: null,
      agentBatchSize: null,
    };
  }

  return {
    agentEnabled: true,
    agentBaseUrl: await promptText(
      driver,
      ctx,
      "WIKI_AGENT_BASE_URL",
      defaults.agentBaseUrl ?? "https://api.openai.com/v1",
      { validator: (value) => validateUrl(value, "WIKI_AGENT_BASE_URL") },
    ),
    agentApiKey: await promptText(
      driver,
      ctx,
      "WIKI_AGENT_API_KEY",
      defaults.agentApiKey ?? "",
      { required: true },
    ),
    agentModel: await promptText(
      driver,
      ctx,
      "WIKI_AGENT_MODEL",
      defaults.agentModel ?? "",
      { required: true },
    ),
    agentBatchSize: await promptText(
      driver,
      ctx,
      "WIKI_AGENT_BATCH_SIZE",
      defaults.agentBatchSize ?? "5",
      { validator: (value) => validateNonNegativeInteger(value, "WIKI_AGENT_BATCH_SIZE") },
    ),
  };
}

function buildSetupSummary(values: SetupValues): string {
  const lines = [
    "Configuration summary",
    `  WIKI_ENV_FILE: ${values.envFilePath}`,
    `  WIKI_PATH: ${values.wikiPath}`,
    `  VAULT_PATH: ${values.vaultPath}`,
    `  WIKI_DB_PATH: ${values.dbPath}`,
    `  WIKI_CONFIG_PATH: ${values.configPath}`,
    `  WIKI_TEMPLATES_PATH: ${values.templatesPath}`,
    `  WIKI_SYNC_INTERVAL: ${values.syncInterval}`,
    `  Embeddings: ${values.embeddingEnabled ? "enabled" : "disabled"}`,
    `  Vault processing: ${values.agentEnabled ? "enabled" : "disabled"}`,
  ];

  if (values.embeddingEnabled) {
    lines.push(`  EMBEDDING_BASE_URL: ${values.embeddingBaseUrl}`);
    lines.push(`  EMBEDDING_MODEL: ${values.embeddingModel}`);
    lines.push(`  EMBEDDING_DIMENSIONS: ${values.embeddingDimensions}`);
  }

  if (values.agentEnabled) {
    lines.push(`  WIKI_AGENT_BASE_URL: ${values.agentBaseUrl}`);
    lines.push(`  WIKI_AGENT_MODEL: ${values.agentModel}`);
    lines.push(`  WIKI_AGENT_BATCH_SIZE: ${values.agentBatchSize}`);
  }

  return lines.join("\n");
}

function writeSetupEnvFile(values: SetupValues): void {
  const existingEntries =
    pathExistsSync(values.envFilePath) ? parseEnvFile(readFileSync(values.envFilePath, "utf8")) : {};
  const preservedEntries = Object.entries(existingEntries).filter(([key]) => !MANAGED_ENV_KEYS.has(key));

  const managedEntries: Array<[string, string | null | undefined]> = [
    ["WIKI_PATH", values.wikiPath],
    ["VAULT_PATH", values.vaultPath],
    ["WIKI_DB_PATH", values.dbPath],
    ["WIKI_CONFIG_PATH", values.configPath],
    ["WIKI_TEMPLATES_PATH", values.templatesPath],
    ["WIKI_SYNC_INTERVAL", values.syncInterval],
    ["EMBEDDING_BASE_URL", values.embeddingEnabled ? values.embeddingBaseUrl : null],
    ["EMBEDDING_API_KEY", values.embeddingEnabled ? values.embeddingApiKey : null],
    ["EMBEDDING_MODEL", values.embeddingEnabled ? values.embeddingModel : null],
    ["EMBEDDING_DIMENSIONS", values.embeddingEnabled ? values.embeddingDimensions : null],
    ["WIKI_AGENT_ENABLED", values.agentEnabled ? "true" : "false"],
    ["WIKI_AGENT_BASE_URL", values.agentEnabled ? values.agentBaseUrl : null],
    ["WIKI_AGENT_API_KEY", values.agentEnabled ? values.agentApiKey : null],
    ["WIKI_AGENT_MODEL", values.agentEnabled ? values.agentModel : null],
    ["WIKI_AGENT_BATCH_SIZE", values.agentEnabled ? values.agentBatchSize : null],
  ];

  const body = [
    "# Generated by `wiki setup`.",
    "# You can edit this file manually and rerun `wiki doctor` to validate changes.",
    "",
    serializeEnvEntries([...managedEntries, ...preservedEntries]),
  ].join("\n");

  writeTextFileSync(values.envFilePath, body);
}

export async function runSetupWizard(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    cwd?: string;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    packageRoot?: string;
  } = {},
): Promise<SetupResult> {
  const cwd = options.cwd ?? process.cwd();
  const output = options.output ?? process.stdout;
  const defaults = getPathDefaults(env, cwd);
  const driver = await createPromptDriver(options.input ?? process.stdin, output);
  const ctx: PromptContext = { cwd, output };

  try {
    writeSection(output, "Step 1/6: Configuration file");
    const envFilePath = await promptText(driver, ctx, "Path for the generated .wiki.env file", defaults.envFilePath, {
      normalize: (value) => resolveInputPath(value, cwd),
    });

    writeSection(output, "Step 2/6: Core paths");
    const wikiPath = await promptText(driver, ctx, "WIKI_PATH", defaults.wikiPath, {
      normalize: (value) => resolveInputPath(value, cwd),
      validator: (value) => validateWikiPath(resolveInputPath(value, cwd)),
    });
    const vaultPath = await promptText(driver, ctx, "VAULT_PATH", defaults.vaultPath, {
      normalize: (value) => resolveInputPath(value, cwd),
    });
    const dbPath = await promptText(driver, ctx, "WIKI_DB_PATH", defaults.dbPath, {
      normalize: (value) => resolveInputPath(value, cwd),
    });
    const configPath = await promptText(driver, ctx, "WIKI_CONFIG_PATH", defaults.configPath, {
      normalize: (value) => resolveInputPath(value, cwd),
    });
    const templatesPath = await promptText(driver, ctx, "WIKI_TEMPLATES_PATH", defaults.templatesPath, {
      normalize: (value) => resolveInputPath(value, cwd),
    });

    writeSection(output, "Step 3/6: Sync schedule");
    const syncInterval = await promptText(driver, ctx, "WIKI_SYNC_INTERVAL (seconds)", defaults.syncInterval, {
      validator: (value) => validateNonNegativeInteger(value, "WIKI_SYNC_INTERVAL"),
    });

    writeSection(output, "Step 4/6: Embedding configuration");
    const embedding = await collectEmbeddingSettings(driver, ctx, defaults, env);

    writeSection(output, "Step 5/6: Automatic vault processing");
    const agent = await collectAgentSettings(driver, ctx, defaults);

    const values: SetupValues = {
      envFilePath,
      wikiPath,
      vaultPath,
      dbPath,
      configPath,
      templatesPath,
      syncInterval,
      ...embedding,
      ...agent,
    };

    writeSection(output, "Step 6/6: Confirm");
    output.write(`${buildSetupSummary(values)}\n`);
    const confirmed = await promptYesNo(driver, ctx, "Write configuration and scaffold workspace assets?", true);
    if (!confirmed) {
      throw new AppError("Setup aborted before writing any files.", "runtime");
    }

    const bootstrap = scaffoldWorkspaceAssets({
      packageRoot: options.packageRoot ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
      wikiRoot: path.resolve(wikiPath, ".."),
      wikiPath,
      vaultPath,
      templatesPath,
      configPath,
    });
    writeSetupEnvFile(values);

    output.write(
      [
        "\nwiki setup complete",
        `configuration file: ${values.envFilePath}`,
        `created directories: ${bootstrap.createdDirectories.length}`,
        `copied config: ${bootstrap.copiedConfig}`,
        `copied templates: ${bootstrap.copiedTemplates}`,
        "",
        "Next steps:",
        "- Run `wiki doctor` to validate the generated configuration.",
        "- Run `wiki init` to create index.db and perform the first sync.",
        ...(values.agentEnabled
          ? ["- Start the background service with `wiki daemon start` or `wiki daemon run` once init succeeds."]
          : []),
      ].join("\n"),
    );

    return {
      envFilePath: values.envFilePath,
      createdDirectories: bootstrap.createdDirectories,
      copiedConfig: bootstrap.copiedConfig,
      copiedTemplates: bootstrap.copiedTemplates,
      embeddingEnabled: values.embeddingEnabled,
      agentEnabled: values.agentEnabled,
    };
  } finally {
    driver.close();
  }
}

function inspectDirectory(
  checks: DoctorCheck[],
  id: string,
  label: string,
  dirPath: string | null,
  options: { required?: boolean; recommendation?: string } = {},
): void {
  if (!dirPath) {
    if (options.required !== false) {
      collectDoctorCheck(
        checks,
        "error",
        id,
        `${label} is not configured.`,
        options.recommendation ?? "Run `wiki setup` to generate a complete workspace configuration.",
      );
    }
    return;
  }

  if (!pathExistsSync(dirPath)) {
    collectDoctorCheck(
      checks,
      "error",
      id,
      `${label} does not exist: ${dirPath}`,
      options.recommendation ?? `Create the directory or rerun \`wiki setup\` to scaffold ${label}.`,
    );
    return;
  }

  try {
    canReadWrite(dirPath);
    collectDoctorCheck(checks, "ok", id, `${label} is readable and writable: ${dirPath}`);
  } catch {
    collectDoctorCheck(
      checks,
      "error",
      id,
      `${label} is not readable and writable: ${dirPath}`,
      `Fix filesystem permissions for ${dirPath}.`,
    );
  }
}

function inspectDbPath(checks: DoctorCheck[], dbPath: string | null): void {
  if (!dbPath) {
    collectDoctorCheck(
      checks,
      "error",
      "db-path",
      "WIKI_DB_PATH is not configured.",
      "Run `wiki setup` to record the database path.",
    );
    return;
  }

  if (pathExistsSync(dbPath)) {
    try {
      canReadWrite(dbPath);
      collectDoctorCheck(checks, "ok", "db-path", `index.db is readable and writable: ${dbPath}`);
    } catch {
      collectDoctorCheck(
        checks,
        "error",
        "db-path",
        `index.db exists but is not readable and writable: ${dbPath}`,
        `Fix filesystem permissions for ${dbPath}.`,
      );
    }
    return;
  }

  const parentDir = path.dirname(dbPath);
  if (pathExistsSync(parentDir)) {
    try {
      canWrite(parentDir);
      collectDoctorCheck(
        checks,
        "warn",
        "db-path",
        `index.db does not exist yet and will be created during \`wiki init\`: ${dbPath}`,
        "Run `wiki init` to create the database and perform the first sync.",
      );
      return;
    } catch {
      // handled below
    }
  }

  collectDoctorCheck(
    checks,
    "error",
    "db-path",
    `index.db cannot be created at ${dbPath}`,
    `Ensure ${parentDir} exists and is writable, or rerun \`wiki setup\`.`,
  );
}

function inspectEmbedding(checks: DoctorCheck[], env: NodeJS.ProcessEnv, probe: boolean): Promise<void> | void {
  const baseUrl = env.EMBEDDING_BASE_URL ?? env.OPENROUTER_BASE_URL;
  const apiKey = env.EMBEDDING_API_KEY ?? env.OPENROUTER_API_KEY;
  const model = env.EMBEDDING_MODEL ?? env.OPENROUTER_EMBEDDING_MODEL;
  const provided = [baseUrl, apiKey, model].filter(Boolean).length;

  if (provided === 0) {
    collectDoctorCheck(
      checks,
      "warn",
      "embedding",
      "Semantic search is disabled because EMBEDDING_* is not configured.",
      "Rerun `wiki setup` or update `.wiki.env` to configure EMBEDDING_* if you want `wiki search`.",
    );
    return;
  }

  try {
    const client = EmbeddingClient.fromEnv(env);
    if (!client) {
      collectDoctorCheck(
        checks,
        "error",
        "embedding",
        "Embedding configuration is incomplete.",
        "Set EMBEDDING_BASE_URL, EMBEDDING_API_KEY, and EMBEDDING_MODEL together.",
      );
      return;
    }

    if (!probe) {
      collectDoctorCheck(
        checks,
        "ok",
        "embedding",
        `Embedding configuration is complete: ${client.settings.model} @ ${client.settings.baseUrl}`,
      );
      return;
    }

    return client
      .probe()
      .then(() => {
        collectDoctorCheck(
          checks,
          "ok",
          "embedding",
          `Embedding probe succeeded for ${client.settings.model}.`,
        );
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        collectDoctorCheck(
          checks,
          "error",
          "embedding",
          `Embedding probe failed: ${message}`,
          "Verify EMBEDDING_BASE_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL, and network reachability.",
        );
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    collectDoctorCheck(
      checks,
      "error",
      "embedding",
      `Embedding configuration is invalid: ${message}`,
      "Fix EMBEDDING_* in `.wiki.env` or rerun `wiki setup`.",
    );
  }
}

function inspectAgent(checks: DoctorCheck[], env: NodeJS.ProcessEnv): void {
  try {
    const settings = resolveAgentSettings(env);
    if (!settings.enabled) {
      collectDoctorCheck(
        checks,
        "ok",
        "agent",
        "Automatic vault processing is disabled.",
      );
      return;
    }

    if (settings.missing.length > 0) {
      collectDoctorCheck(
        checks,
        "error",
        "agent",
        `Automatic vault processing is enabled but missing: ${settings.missing.join(", ")}`,
        "Set the missing WIKI_AGENT_* values in `.wiki.env` or rerun `wiki setup`.",
      );
      return;
    }

    collectDoctorCheck(
      checks,
      "ok",
      "agent",
      `Automatic vault processing is enabled with model ${settings.model}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    collectDoctorCheck(
      checks,
      "error",
      "agent",
      `Agent configuration is invalid: ${message}`,
      "Fix WIKI_AGENT_* in `.wiki.env` or rerun `wiki setup`.",
    );
  }
}

function inspectConfigAndTemplates(checks: DoctorCheck[], configPath: string | null, wikiRoot: string | null): void {
  if (!configPath) {
    collectDoctorCheck(
      checks,
      "error",
      "config",
      "WIKI_CONFIG_PATH is not configured.",
      "Run `wiki setup` to record the config path.",
    );
    return;
  }

  if (!pathExistsSync(configPath)) {
    collectDoctorCheck(
      checks,
      "error",
      "config",
      `wiki.config.json does not exist: ${configPath}`,
      "Run `wiki setup` or `wiki init` to scaffold wiki.config.json.",
    );
    return;
  }

  try {
    const config = loadConfig(configPath);
    if (!wikiRoot) {
      collectDoctorCheck(checks, "ok", "config", `Config loaded: ${configPath}`);
      return;
    }

    const missingTemplates = Object.keys(config.templates)
      .map((pageType) => ({
        pageType,
        templatePath: resolveTemplateFilePath(config, wikiRoot, pageType),
      }))
      .filter((entry) => !pathExistsSync(entry.templatePath));

    if (missingTemplates.length > 0) {
      collectDoctorCheck(
        checks,
        "error",
        "templates",
        `Missing template files: ${missingTemplates.map((entry) => entry.pageType).join(", ")}`,
        "Run `wiki setup` or restore the missing template files under WIKI_TEMPLATES_PATH.",
      );
      return;
    }

    collectDoctorCheck(
      checks,
      "ok",
      "config",
      `Config loaded successfully with ${Object.keys(config.templates).length} registered templates.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    collectDoctorCheck(
      checks,
      "error",
      "config",
      `Failed to load config: ${message}`,
      "Fix wiki.config.json or rerun `wiki setup` to scaffold a clean copy.",
    );
  }
}

function inspectDaemon(checks: DoctorCheck[], wikiRoot: string | null): void {
  if (!wikiRoot) {
    return;
  }

  const pidPath = path.join(wikiRoot, ".wiki-daemon.pid");
  const statePath = path.join(wikiRoot, ".wiki-daemon.state.json");

  if (!pathExistsSync(pidPath)) {
    collectDoctorCheck(
      checks,
      "warn",
      "daemon",
      "The wiki daemon is not running.",
      "Run `wiki daemon start` after `wiki init` if you want automatic sync cycles.",
    );
    return;
  }

  try {
    const rawPid = readFileSync(pidPath, "utf8").trim();
    const pid = Number.parseInt(rawPid, 10);
    if (!Number.isFinite(pid)) {
      collectDoctorCheck(
        checks,
        "error",
        "daemon",
        `Daemon PID file is invalid: ${pidPath}`,
        "Remove the stale PID file or restart the daemon.",
      );
      return;
    }

    try {
      process.kill(pid, 0);
      collectDoctorCheck(
        checks,
        "ok",
        "daemon",
        `The wiki daemon is running with PID ${pid}${pathExistsSync(statePath) ? " and has a state file." : "."}`,
      );
    } catch {
      collectDoctorCheck(
        checks,
        "error",
        "daemon",
        `Daemon PID file exists but process ${pid} is not running.`,
        "Run `wiki daemon stop` to clear stale state, then restart the daemon if needed.",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    collectDoctorCheck(
      checks,
      "error",
      "daemon",
      `Failed to inspect daemon state: ${message}`,
      "Check the daemon state files under the wiki workspace root.",
    );
  }
}

function summarizeChecks(checks: DoctorCheck[]) {
  return checks.reduce(
    (summary, check) => {
      summary[check.severity] += 1;
      return summary;
    },
    { ok: 0, warn: 0, error: 0 },
  );
}

function uniqueRecommendations(checks: DoctorCheck[]): string[] {
  return Array.from(new Set(checks.map((check) => check.recommendation).filter(Boolean) as string[]));
}

export async function buildDoctorReport(
  env: NodeJS.ProcessEnv = process.env,
  options: { probe?: boolean } = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const envFile = getCliEnvironmentInfo();

  if (envFile.missingRequestedPath && envFile.requestedPath) {
    collectDoctorCheck(
      checks,
      "error",
      "env-file",
      `Requested env file does not exist: ${envFile.requestedPath}`,
      "Create the env file or rerun `wiki setup`.",
    );
  } else if (envFile.loadedPath) {
    collectDoctorCheck(
      checks,
      "ok",
      "env-file",
      `Loaded configuration from ${envFile.loadedPath}${envFile.autoDiscovered ? " (auto-discovered)." : "."}`,
    );
  } else {
    collectDoctorCheck(
      checks,
      "warn",
      "env-file",
      "No .wiki.env file was loaded; using process.env only.",
      "Run `wiki setup` to generate a portable `.wiki.env` file.",
    );
  }

  const wikiPath = env.WIKI_PATH ? path.resolve(env.WIKI_PATH) : null;
  const wikiRoot = wikiPath ? path.resolve(wikiPath, "..") : null;
  const vaultPath = wikiRoot ? path.resolve(env.VAULT_PATH ?? path.join(wikiRoot, "..", "vault")) : null;
  const dbPath = wikiRoot ? path.resolve(env.WIKI_DB_PATH ?? path.join(wikiRoot, "index.db")) : null;
  const configPath = wikiRoot ? path.resolve(env.WIKI_CONFIG_PATH ?? path.join(wikiRoot, "wiki.config.json")) : null;
  const templatesPath = wikiRoot ? path.resolve(env.WIKI_TEMPLATES_PATH ?? path.join(wikiRoot, "templates")) : null;

  inspectDirectory(checks, "wiki-path", "WIKI_PATH", wikiPath, {
    recommendation: "Run `wiki setup` to generate WIKI_PATH and scaffold wiki/pages.",
  });
  inspectDirectory(checks, "vault-path", "VAULT_PATH", vaultPath, {
    recommendation: "Run `wiki setup` to generate VAULT_PATH and scaffold the vault directory.",
  });
  inspectDirectory(checks, "templates-path", "WIKI_TEMPLATES_PATH", templatesPath, {
    recommendation: "Run `wiki setup` or restore template files under WIKI_TEMPLATES_PATH.",
  });
  inspectDbPath(checks, dbPath);
  inspectConfigAndTemplates(checks, configPath, wikiRoot);
  await inspectEmbedding(checks, env, options.probe === true);
  inspectAgent(checks, env);
  inspectDaemon(checks, wikiRoot);

  const summary = summarizeChecks(checks);
  return {
    ok: summary.error === 0,
    summary,
    envFile: {
      requestedPath: envFile.requestedPath,
      loadedPath: envFile.loadedPath,
      autoDiscovered: envFile.autoDiscovered,
      missingRequestedPath: envFile.missingRequestedPath,
    },
    effectivePaths: {
      wikiPath,
      vaultPath,
      dbPath,
      configPath,
      templatesPath,
    },
    checks,
    recommendations: uniqueRecommendations(checks),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = ["wiki doctor", ""];

  for (const check of report.checks) {
    lines.push(`${check.severity.toUpperCase().padEnd(5)} ${check.id.padEnd(14)} ${check.summary}`);
  }

  lines.push("");
  lines.push(`Summary: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.error} error`);

  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("Recommended actions:");
    for (const recommendation of report.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  return lines.join("\n");
}
