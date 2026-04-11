# Template Design Guide

How to design a new page type and its template for the wiki. Use this guide when the current ontology cannot cleanly represent new knowledge and a new type is genuinely needed.

---

## When to Create a New Type vs. Use an Existing One

Before creating a new type, check whether the knowledge fits an existing type:

- **Structural difference** → new type needed (different fields, different sections)
- **Topic difference only** → use an existing type with different tags

Examples:
- "Environmental research note" vs. "Education research note" → same `research-note` type, different tags
- "Meeting minutes" vs. "Research note" → structurally different (participants, decisions, action items vs. research questions, literature, findings), new type needed

**Always discover the current ontology first:**

```bash
tiangong-wiki type list --format json
tiangong-wiki type recommend --text "<summary>" --keywords "a,b,c" --limit 5 --format json
```

If `type recommend` returns a good fit with high confidence, use that type. Only proceed with type creation when the fit is clearly poor.

## Create vs. Propose Only

When the existing type system is not a clean fit:

- **Create the template yourself** when the need is clear, the structure is well-defined, and you can design a complete template following this guide.
- **Use `propose_only`** (in vault-to-wiki workflow) or flag for human review when:
  - The knowledge domain is unfamiliar and the right structure is uncertain
  - Multiple reasonable type designs exist and the choice has long-term ontology impact
  - The new type would overlap significantly with existing types

See `references/vault-to-wiki-instruction.md` for how `propose_only` works in the vault workflow.

---

## Template Composition

A template has two parts — both are required:

### Template File (`templates/<type>.md`)

Defines the frontmatter fields and body section skeleton:

```yaml
---
pageType: <type>
title: <Type Title>
nodeId: <type-slug>
status: draft
visibility: private
sourceRefs: []
relatedPages: []
tags: []
createdAt: 2026-04-06
updatedAt: 2026-04-06
# ... type-specific fields
---

## Section 1

Guiding prompt that tells the author what to write in this section.

## Section 2

...
```

### Config Registration (`wiki.config.json` under `templates.<type>`)

Defines how the type is indexed:

```json
{
  "file": "templates/<type>.md",
  "columns": { },
  "edges": { },
  "summaryFields": [ ]
}
```

The template file defines "what to write"; the config registration defines "how to index".

---

## Frontmatter Field Design

### Common Fields (inherited automatically)

All types share these fields — always include them in the template:

```yaml
pageType, title, nodeId, status, visibility,
sourceRefs, relatedPages, tags, createdAt, updatedAt
```

### Type-Specific Field Principles

1. **Only add fields that serve querying or classification.** If a field only appears in the body, it does not belong in frontmatter.
2. **Field values should be short text or enums**, not long paragraphs. Long content belongs in body sections.
3. **Use camelCase for field names** — the system maps them to snake_case column names automatically.
4. **Do not duplicate common field semantics.** For example, do not add a `category` field when `tags` already serves that purpose.

### Where to Register Each Field

| Question | Register in | Reason |
| --- | --- | --- |
| Need `tiangong-wiki find --<field>` filtering? | `columns` | Creates a SQLite indexed column for structured queries |
| Should appear in `search` / `fts` summaries? | `summaryFields` | Included in `summary_text` for retrieval |
| Generates an edge to another page/node? | `edges` | Written to the edges table for graph traversal |
| Just supplementary page info? | Still must be declared | Current implementation rejects undeclared fields — register in `columns`, `edges`, or `commonEdges` |

---

## Columns Design

Fields in `columns` become indexed columns on the `pages` table, supporting `tiangong-wiki find` filtering.

```json
"columns": {
  "severity": "text",
  "resolvedAt": "text"
}
```

Key points:
- Column type is currently only `"text"`
- Only fields that need frequent value-based filtering are worth indexing
- Different types share the same `pages` table — columns from other types are NULL
- Column names are globally unique — if two types both have `severity`, they share one column
- Every type-specific frontmatter field must be declared in at least `columns`, `edges`, or `commonEdges`; otherwise lint reports `unregistered_fields`

---

## Edges Design

`edges` defines how frontmatter array fields generate graph edges.

```json
"edges": {
  "prerequisites": {
    "edgeType": "prerequisite",
    "resolve": "nodeId"
  }
}
```

| Field | Required | Description |
| --- | --- | --- |
| `edgeType` | Yes | Edge type identifier, written to `edges.edge_type` |
| `resolve` | Yes | Target matching: `"nodeId"` matches `pages.node_id`; `"path"` matches `pages.id` |
| `match` | No | Regex pre-filter — only matching values participate in resolve |

Key points:
- Only array fields **pointing to other pages or nodes** need edge definitions
- `edgeType` should express a semantic relationship (`prerequisite`, `corrects`, `bridges_from`), not just the field name
- `commonEdges` (`relatedPages`, `sourceRefs`) are global — do not redefine them in templates

---

## SummaryFields Design

Fields in `summaryFields` are concatenated into `pages.summary_text` for semantic search and full-text search.

```json
"summaryFields": ["confidence", "masteryLevel", "prerequisites"]
```

Key points:
- Choose fields that help retrieval — e.g., `domain: "environmental engineering"` helps search find the page
- Avoid long-text fields; `summary_text` should stay concise
- `defaultSummaryFields` (`title`, `tags`) are included automatically
- `summaryFields` only controls inclusion in `summary_text` — the field itself must still be declared in `columns`, `edges`, or `commonEdges`

---

## Body Section Design

Body sections are the Markdown skeleton after frontmatter, guiding the author (human or AI) to write structured content.

Principles:
1. **Each section starts with `##`**
2. **Write a specific guiding prompt** that explains the purpose and expected content
3. **Keep section count to 3–6** — too few lacks structure, too many adds burden
4. **Sections should have logical progression** — e.g., "what it is" → "why it matters" → "how to use it"

Good prompt example:

```markdown
## Core Understanding

In two to four sentences, explain what this concept is and why it is worth remembering.
```

Bad prompt example:

```markdown
## Content

<!-- Fill in content here -->
```

---

## Complete Example

Designing a `meeting-note` type:

### Template File `templates/meeting-note.md`

```yaml
---
pageType: meeting-note
title: Meeting Note Title
nodeId: meeting-note-slug
status: draft
visibility: private
sourceRefs: []
relatedPages: []
tags: []
createdAt: 2026-04-06
updatedAt: 2026-04-06
meetingDate:
participants: []
decisions: []
---

## Background

Briefly explain the purpose and context of this meeting so someone who did not attend can quickly understand why it was held.

## Key Discussion

Record the most important discussion points and disagreements. Focus on conflicts and final consensus, not a chronological transcript.

## Decisions

List specific decisions reached. Each decision should be actionable, not a vague direction.

## Follow-up Actions

List action items with owners and expected completion dates.
```

### Config Registration

```json
"meeting-note": {
  "file": "templates/meeting-note.md",
  "columns": {
    "meetingDate": "text"
  },
  "edges": {},
  "summaryFields": ["meetingDate", "participants", "decisions"]
}
```

Design rationale:
- `meetingDate` as column — needed for date-based filtering
- `participants` not a column — searching via `tiangong-wiki fts` on summary_text is sufficient
- `participants` and `decisions` in summaryFields — helps search hits
- `decisions` not an edge — decisions are text, not references to other pages
- 4 body sections — background → discussion → decisions → follow-up, logical progression

---

## Checklist

After designing a template, verify:

- [ ] The new type is structurally different from all existing types (not just topically different)?
- [ ] Every frontmatter field has a clear querying or classification purpose?
- [ ] Fields needing `tiangong-wiki find` filtering are in `columns`?
- [ ] Array fields generating graph edges are defined in `edges`?
- [ ] `summaryFields` includes key fields that aid retrieval?
- [ ] Every type-specific frontmatter field is declared in `columns`, `edges`, or `commonEdges`?
- [ ] Body has 3–6 sections with logical progression?
- [ ] Section prompts are specific, not generic placeholders?
- [ ] After creating a test page with `tiangong-wiki create --type <type> --title <title>`, both `tiangong-wiki lint` and `tiangong-wiki sync` pass with no errors?
