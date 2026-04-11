---
name: tiangong-wiki-skill
description: "Use when you need to retrieve historically accumulated knowledge, methods, or behavioral patterns before answering or acting; when a conversation or workflow produces durable insights worth preserving for future reuse; or when you discover existing wiki content that is outdated or incorrect and needs correction."
---

# Wiki Skill

## Core Goal

Use the local wiki as the **durable knowledge layer** — not just for the current conversation, but for all future work. Query first, then read or edit the Markdown files that remain the source of truth.

## When to Use

Activate this skill in three scenarios:

### 1. Knowledge Retrieval

You need historical knowledge, methods, behavioral patterns, or prior decisions before answering or acting.

**Trigger:** The current task could benefit from previously captured insights, or the user asks about something that may already exist in the wiki.

**Minimal steps:**
1. Choose a retrieval strategy based on what you know:
   - Know the type, tag, or metadata → `tiangong-wiki find`
   - Have a keyword or short phrase → `tiangong-wiki fts`
   - Fuzzy intent, embeddings configured → `tiangong-wiki search`
   - Need graph context or related pages → `tiangong-wiki graph`
2. Inspect the best candidate with `tiangong-wiki page-info <id>`.
3. Read the Markdown file if you need full content.

**Stop when:** you have enough context to proceed, or no relevant pages exist.

### 2. Knowledge Capture

A conversation, task, or other skill produced a high-value insight, method, correction, or piece of information worth preserving.

**Trigger:** You recognize durable knowledge — something that would be useful to retrieve in a future context.

**Two paths:**

- **Direct page creation** — when you can clearly identify the page type and structure the content yourself:
  1. Search for existing pages to avoid duplicates (`find`, `fts`, or `search`).
  2. Discover the ontology: `tiangong-wiki type recommend --text "<summary>" --keywords "a,b,c" --format json`.
  3. Update an existing page if one covers the same knowledge object. Create a new page only when the object is distinct.
  4. After writing: `tiangong-wiki sync --path <page-id>` then `tiangong-wiki lint --path <page-id> --format json`.

- **Save to vault** — when the material is raw, complex, or needs further processing:
  1. Save the file to `vault/`.
  2. The vault-to-wiki workflow will handle triage and page creation.
  3. See `references/vault-to-wiki-instruction.md` for the full decision model.

**Key rules:**
- Do not assume any page type is the default destination. Always discover via CLI.
- Prefer updating the best existing page over creating near-duplicates.
- Only use frontmatter fields declared by the chosen type (`tiangong-wiki type show <type>`). Do not invent ad-hoc fields.
- Preserve provenance with `sourceRefs` and type-specific source fields.

### 3. Knowledge Maintenance

You discover that existing wiki content is outdated, incorrect, or incomplete during retrieval or conversation.

**Trigger:** A retrieved page contains stale information, or new evidence contradicts existing content.

**Minimal steps:**
1. Locate the page: `tiangong-wiki find` or `tiangong-wiki page-info <id>`.
2. Edit the Markdown file — keep edits minimal and provenance-preserving.
3. After editing: `tiangong-wiki sync --path <page-id>` then `tiangong-wiki lint --path <page-id> --format json`.

**For systematic maintenance** (health checks, orphan cleanup, stale content review), see `references/wiki-maintenance-instruction.md`.

## References (read on demand)

| Document | Read when... |
|----------|-------------|
| `references/cli-interface.md` | You need full command options, flags, or output format details |
| `references/vault-to-wiki-instruction.md` | Processing vault files into wiki pages |
| `references/wiki-maintenance-instruction.md` | Running systematic maintenance or health checks |
| `references/template-design-guide.md` | Designing a new page type or evolving an existing template |
| `references/troubleshooting.md` | Environment setup, configuration issues, or error diagnosis |

## Assets

- `assets/wiki.config.default.json` — default configuration template
- `assets/templates/` — Markdown page templates for each registered type
