# Environment Variables

## Required

The CLI loads configuration in this order:

1. existing `process.env`
2. explicit `WIKI_ENV_FILE`
3. nearest auto-discovered `.wiki.env` in the current working directory or its parents

`wiki setup` writes a `.wiki.env` file that follows this contract. Real process env vars still win over file values.
The same setup flow also installs workspace-local skills under `workspace/.agents/skills/`.

| Variable | Description | Example |
| --- | --- | --- |
| `WIKI_ENV_FILE` | Optional path to a `.wiki.env` file to load before resolving runtime paths | `/data/workspace/.wiki.env` |
| `WIKI_PATH` | Absolute path to `wiki/pages/` | `/data/workspace/wiki/pages` |

## Core Optional Paths

| Variable | Default | Description |
| --- | --- | --- |
| `VAULT_PATH` | sibling `../vault` next to `WIKI_PATH` | Absolute path to the vault directory. In Synology mode this becomes the local cache directory. |
| `WIKI_DB_PATH` | `WIKI_PATH/../index.db` | SQLite index database path |
| `WIKI_CONFIG_PATH` | `WIKI_PATH/../wiki.config.json` | Runtime config file path |
| `WIKI_TEMPLATES_PATH` | `WIKI_PATH/../templates` | Runtime template directory |
| `WIKI_SYNC_INTERVAL` | `86400` | Daemon sync interval in seconds |

## Workspace Skills

`wiki setup` always installs `wiki-skill` into `workspace/.agents/skills/wiki-skill`.
If you opt into parser skills during setup, they are installed into the same workspace-local skills directory and recorded in `.wiki.env`.

| Variable | Default | Description |
| --- | --- | --- |
| `WIKI_PARSER_SKILLS` | empty | Comma-separated optional parser skills selected during `wiki setup`, such as `pdf,docx`; `wiki doctor` uses this to verify expected workspace-local parser skills |

## Embedding

When any required embedding variable is missing, `wiki sync` skips vector generation and `wiki search` returns a `not_configured` error.

| Variable | Default | Description |
| --- | --- | --- |
| `EMBEDDING_BASE_URL` | none | OpenAI-compatible embedding API base URL |
| `EMBEDDING_API_KEY` | none | Embedding API key |
| `EMBEDDING_MODEL` | none | Embedding model name |
| `EMBEDDING_DIMENSIONS` | `384` | Vector dimension for `vec_pages` |

### Smoke-test fallback

For local smoke tests, the implementation also accepts these fallback variables when the `EMBEDDING_*` trio is absent:

- `OPENROUTER_BASE_URL`
- `OPENROUTER_API_KEY`
- `OPENROUTER_EMBEDDING_MODEL`

These are for development convenience only. The portable contract remains `EMBEDDING_*`.

## Automatic Vault Processing

These variables control the service-layer queue processor.

| Variable | Default | Description |
| --- | --- | --- |
| `WIKI_AGENT_ENABLED` | `false` | Enable automatic vault-to-wiki processing after full sync cycles |
| `WIKI_AGENT_BASE_URL` | `https://api.openai.com/v1` | Optional Codex/OpenAI API base URL override for the workflow runner |
| `WIKI_AGENT_API_KEY` | none | API key used by the Codex workflow runner |
| `WIKI_AGENT_MODEL` | none | Model name used by the Codex workflow runner |
| `WIKI_AGENT_BATCH_SIZE` | `5` | Max queue items processed per cycle |
| `WIKI_AGENT_BACKEND` | `codex-workflow` | Queue execution backend; `codex-workflow` is the supported production path |
| `WIKI_AGENT_ALLOW_TEMPLATE_EVOLUTION` | `false` | Allow the workflow to apply template/type creation actions instead of proposal-only behavior |
| `WIKI_AGENT_TEMPLATE_EVOLUTION_MODE` | `proposal` | `proposal` or `apply`; only `apply` permits `create_template` actions to be accepted |

Validation:
- if `WIKI_AGENT_ENABLED=false`, missing agent credentials are ignored
- if `WIKI_AGENT_ENABLED=true`, `WIKI_AGENT_API_KEY` and `WIKI_AGENT_MODEL` are required

## NAS / Synology

| Variable | Default | Description |
| --- | --- | --- |
| `VAULT_SOURCE` | `local` | `local` or `synology` |
| `VAULT_HASH_MODE` | `content` | `content` hashes full file bytes; `mtime` hashes `path + size + mtime` |
| `VAULT_SYNOLOGY_REMOTE_PATH` | none | Remote Synology vault path such as `/homes/user/vault` |
| `SYNOLOGY_BASE_URL` | none | Synology DSM base URL such as `https://nas.example.com:5001` |
| `SYNOLOGY_USERNAME` | none | Synology DSM username |
| `SYNOLOGY_PASSWORD` | none | Synology DSM password |
| `SYNOLOGY_VERIFY_SSL` | `true` | Whether to verify DSM TLS certificates |
| `SYNOLOGY_READONLY` | `false` | Read-only policy flag stored for future mutation safety; `wiki setup` defaults it to `true` |

Behavior:
- `VAULT_SOURCE=local`: scan the local vault path directly
- `VAULT_SOURCE=synology`: poll Synology File Station for file metadata and use `VAULT_PATH` as the local cache directory for downloaded files
- `VAULT_HASH_MODE=mtime`: preferred for large mounted vaults or slow NAS storage
- `VAULT_HASH_MODE=content`: preferred when exact byte-level change detection matters more than scan cost
- `wiki setup` can now write the full Synology block step by step
- `wiki doctor --probe` validates Synology credentials and performs a lightweight NAS connectivity probe
