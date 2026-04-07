import type { PageType } from "../types/dashboard";

export const PAGE_TYPE_COLORS: Record<string, string> = {
  concept: "#68a8ff",
  method: "#58d6a7",
  lesson: "#ffbf5a",
  "source-summary": "#8f9bb3",
  "research-note": "#b18cff",
  misconception: "#ff7a7a",
  bridge: "#45d7cf",
  person: "#ff9b61",
  achievement: "#ff7fe8",
  faq: "#57c7ff",
  resume: "#b4b7c4",
};

export function colorForPageType(pageType: PageType): string {
  return PAGE_TYPE_COLORS[String(pageType)] ?? "#8f9bb3";
}
