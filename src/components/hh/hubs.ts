// Hobby Hub's five hubs (redesign, 2026-11-03). One place decides which hub owns
// a URL, so the top bar, the phone tab bar and the sub-tabs never disagree.
// URLs did not move: emails, workflows and bookmarks still point at /picks,
// /l/[id]/waivers and the rest. The only new path is /fantasy (the league list
// that used to live at /); / now opens Today.

export type HubKey = "today" | "bets" | "fantasy" | "money" | "results";

export interface SubTab {
  href: string;
  label: string;
  owns: (p: string) => boolean;
}

export interface Hub {
  key: HubKey;
  label: string;
  href: string;
  owns: (p: string) => boolean;
  /** Second row of tabs inside the hub. Empty for single-page hubs. */
  tabs: SubTab[];
}

export const under = (p: string, base: string) => p === base || p.startsWith(base + "/");

/** The model record reads as a result, not a bet, so Results claims it before Bets does. */
const isModelRecord = (p: string) => under(p, "/picks/model");

export const HUBS: Hub[] = [
  {
    key: "today",
    label: "Today",
    href: "/today",
    owns: (p) => p === "/" || under(p, "/today"),
    tabs: [],
  },
  {
    key: "bets",
    label: "Bets",
    href: "/picks",
    owns: (p) => (under(p, "/picks") && !isModelRecord(p)) || under(p, "/props"),
    tabs: [
      { href: "/picks", label: "Picks", owns: (p) => under(p, "/picks") && !isModelRecord(p) },
      { href: "/props", label: "Props", owns: (p) => under(p, "/props") },
    ],
  },
  {
    key: "fantasy",
    label: "Fantasy",
    href: "/fantasy",
    owns: (p) => ["/fantasy", "/l", "/survivor", "/strategy", "/resources"].some((b) => under(p, b)),
    tabs: [
      { href: "/fantasy", label: "Leagues", owns: (p) => under(p, "/fantasy") || under(p, "/l") },
      { href: "/survivor", label: "Survivor", owns: (p) => under(p, "/survivor") },
      { href: "/strategy", label: "Strategy", owns: (p) => under(p, "/strategy") },
      { href: "/resources", label: "Resources", owns: (p) => under(p, "/resources") },
    ],
  },
  {
    key: "money",
    label: "Money",
    href: "/money",
    owns: (p) => under(p, "/money"),
    tabs: [],
  },
  {
    key: "results",
    label: "Results",
    href: "/records",
    owns: (p) => under(p, "/records") || under(p, "/learning") || isModelRecord(p),
    tabs: [
      { href: "/records", label: "Records", owns: (p) => under(p, "/records") },
      { href: "/learning", label: "Learning", owns: (p) => under(p, "/learning") },
      { href: "/picks/model", label: "Model record", owns: isModelRecord },
    ],
  },
];

export function hubFor(p: string): Hub | null {
  return HUBS.find((h) => h.owns(p)) ?? null;
}
