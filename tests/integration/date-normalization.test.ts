import { afterEach, describe, expect, it, vi } from "vitest";

import { syncWorkspace } from "../../src/core/sync.js";
import {
  bootstrapRuntimeAssets,
  cleanupWorkspace,
  createWorkspace,
  queryDb,
  writePage,
} from "../helpers.js";

describe("date normalization integration", () => {
  const workspaces: ReturnType<typeof createWorkspace>[] = [];

  afterEach(() => {
    vi.useRealTimers();
    while (workspaces.length > 0) {
      cleanupWorkspace(workspaces.pop()!);
    }
  });

  it("preserves createdAt, refreshes updatedAt on modified pages, and falls back missing dates", async () => {
    vi.useFakeTimers();

    const workspace = createWorkspace();
    workspaces.push(workspace);
    bootstrapRuntimeAssets(workspace);

    vi.setSystemTime(new Date("2026-04-07T09:00:00Z"));
    writePage(
      workspace,
      "concepts/date-rollover.md",
      `---
pageType: concept
title: Date Rollover
nodeId: date-rollover
status: active
visibility: shared
sourceRefs: []
relatedPages: []
tags: []
createdAt: 2026-04-01T10:20:30.000Z
updatedAt: 2026-04-02T11:22:33.000Z
confidence: high
masteryLevel: medium
prerequisites: []
---

Initial body.
`,
    );
    writePage(
      workspace,
      "concepts/missing-dates.md",
      `---
pageType: concept
title: Missing Dates
nodeId: missing-dates
status: active
visibility: shared
sourceRefs: []
relatedPages: []
tags: []
confidence: high
masteryLevel: medium
prerequisites: []
---

Dates should fall back to the current day.
`,
    );

    await syncWorkspace({ env: workspace.env });

    const initialRows = queryDb<Record<string, string>>(
      workspace,
      `
        SELECT id, created_at AS createdAt, updated_at AS updatedAt
        FROM pages
        WHERE id IN ('concepts/date-rollover.md', 'concepts/missing-dates.md')
        ORDER BY id
      `,
    );
    expect(initialRows).toEqual([
      {
        id: "concepts/date-rollover.md",
        createdAt: "2026-04-01",
        updatedAt: "2026-04-02",
      },
      {
        id: "concepts/missing-dates.md",
        createdAt: "2026-04-07",
        updatedAt: "2026-04-07",
      },
    ]);

    vi.setSystemTime(new Date("2026-04-09T09:00:00Z"));
    writePage(
      workspace,
      "concepts/date-rollover.md",
      `---
pageType: concept
title: Date Rollover
nodeId: date-rollover
status: active
visibility: shared
sourceRefs: []
relatedPages: []
tags: []
createdAt: 2026-04-01T10:20:30.000Z
updatedAt: 2026-04-02T11:22:33.000Z
confidence: high
masteryLevel: medium
prerequisites: []
---

Updated body.
`,
    );

    await syncWorkspace({ targetPaths: ["concepts/date-rollover.md"], env: workspace.env });

    const updatedRows = queryDb<Record<string, string>>(
      workspace,
      `
        SELECT id, created_at AS createdAt, updated_at AS updatedAt
        FROM pages
        WHERE id = 'concepts/date-rollover.md'
      `,
    );
    expect(updatedRows).toEqual([
      {
        id: "concepts/date-rollover.md",
        createdAt: "2026-04-01",
        updatedAt: "2026-04-09",
      },
    ]);
  });
});
