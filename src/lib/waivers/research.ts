import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { redis } from "@/lib/redis/client";

// The week's waiver consensus, researched on the open web.
//
// Jingles is the first opinion this app trusts, and when his lists are stale
// for a waiver run the wire needs a second one that is not just add counts.
// This asks Claude to read the week's waiver columns (FantasyPros, RotoBaller,
// FTN, Fantasy Life, Dynasty Nerds, the subreddits) and return one ranked,
// tiered list with a FAAB percentage per player, in the shape the pricing
// model already speaks. It runs from a scheduled workflow on Tuesdays, never
// from a page render: a web-search turn takes a minute and costs real money,
// so the result is cached for the week and the page only ever reads it.

const MODEL = "claude-opus-5";

/** Searches per format. Six covers the columns named in the prompt. */
const SEARCH_USES = 6;

/** Long enough that a Tuesday morning run still serves Wednesday's page. */
const RESEARCH_TTL = 5 * 24 * 60 * 60;

export type ResearchFormat = "dynasty" | "redraft";

export const RESEARCH_TIERS = ["winner", "starter", "multiweek", "streamer", "filler", "stash"] as const;
export type ResearchTier = (typeof RESEARCH_TIERS)[number];

const TargetSchema = z.object({
  name: z.string(),
  team: z.string().nullable(),
  position: z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]),
  tier: z.enum(RESEARCH_TIERS),
  /** Consensus bid as a percent of the original budget. Null when no source gave one. */
  faabPercent: z.number().nullable(),
  /** One or two sentences: the role change and why the room is chasing him. */
  note: z.string(),
  sources: z.array(z.string()),
});

const ResearchSchema = z.object({
  targets: z.array(TargetSchema),
  sources: z.array(z.string()),
});

export type ResearchTarget = z.infer<typeof TargetSchema>;

export interface WaiverResearch {
  season: string;
  week: number;
  format: ResearchFormat;
  generatedAt: string;
  targets: ResearchTarget[];
  sources: string[];
  /** The start of what the research wrote, kept so an odd list can be read back. */
  proseExcerpt: string;
}

const KEY = (season: string, week: number, format: ResearchFormat) =>
  `waivers:v1:research:${season}:w${week}:${format}`;

export async function readWaiverResearch(
  season: string,
  week: number,
  format: ResearchFormat,
): Promise<WaiverResearch | null> {
  try {
    return (await redis.get<WaiverResearch>(KEY(season, week, format))) ?? null;
  } catch {
    return null;
  }
}

function researchPrompt(format: ResearchFormat, season: string, week: number): string {
  const played = week - 1;
  const common = `It is the ${season} NFL season. Week ${played} has just been played and week ${week} waivers process on Wednesday. Search this week's waiver wire columns and threads, then produce the consensus list of the best 20 waiver claims. For every player give: full name, NFL team, position, the role or usage change behind the recommendation (snaps, routes, targets, carries, a starter's injury, a depth chart promotion), a tier, and the consensus FAAB bid as a percent of the ORIGINAL budget with the range the sources give. Only include players likely to be on waivers in a typical 12-team league (rostered under about 60 percent). Skip anyone whose case is one touchdown on the same snap count. Name your sources with URLs.

Write every player as its own block with these labelled lines: Name, Team, Position, Tier, FAAB (the bid as a percent of the original budget, with the range the sources give; convert dollar bids against that source's budget, so $12 of $100 is 12% and $150 of $1000 is 15%; if no source gives a bid, write "FAAB: none"), Why (one or two sentences on the role change), Sources. The FAAB line matters most: search the columns that publish bids (FantasyPros gives three bid levels, RotoBaller publishes a FAAB bidding column) and quote them.`;

  if (format === "dynasty") {
    return `${common}

League shape: 12-team dynasty, superflex, full PPR, $1000 FAAB for the season. Sources to check: Dynasty Nerds waiver wire week ${week}, Dynasty Daddy waiver wire, FantasyPros dynasty waiver wire, r/DynastyFF waiver threads, plus the redraft columns (FantasyPros, RotoBaller) for role changes. If dynasty-specific columns for this week are thin, build the list from the redraft columns and judge the dynasty angle yourself; never return an empty list when the redraft columns name players. Include rookies and young players with rising usage and say whether each player matters more to a contender or a rebuilder. Tiers: winner (young player into an every-down or high-target role), starter (starts every week the rest of the year), multiweek (starts for 3 to 6 weeks), streamer (one week at QB, TE, K or DEF), filler (enters a lineup this week only), stash (developmental, no lineup path yet).`;
  }
  return `${common}

League shape: 12-team redraft, one QB, full or half PPR, $100 FAAB for the season. Sources to check: FantasyPros waiver wire week ${week} (it gives True Value, Desperate Need and Budget-Minded bids), RotoBaller FAAB bidding week ${week}, FTN waiver wire tool, Fantasy Life waiver wire, r/fantasyfootball waiver threads. Tiers: winner (a league-winning back after a starter's season-ending injury), starter (a new every-week starter), multiweek (an injury fill for 3 to 6 weeks), streamer (one week at QB, TE, K or DEF), filler (bye or injury cover for one week), stash (a bench-only speculative add).`;
}

/**
 * Research one format for one week and cache it.
 *
 * Two calls on purpose. The first reads the web and writes prose; the second
 * turns that prose into the schema. Asking one call to search and emit JSON
 * at once produces worse lists, and the extraction is cheap.
 */
export async function researchWaiverTargets(
  format: ResearchFormat,
  season: string,
  week: number,
): Promise<WaiverResearch> {
  const client = new Anthropic({ timeout: 4 * 60 * 1000 });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: researchPrompt(format, season, week) },
  ];

  // A long search turn can pause; resume until it ends on its own.
  // Medium effort and a search cap keep one format inside a five-minute
  // function budget. The columns are short and the list is twenty names;
  // this is reading, not reasoning.
  let response = await client.messages.create({
    model: MODEL,
    max_tokens: 12000,
    output_config: { effort: "medium" },
    system:
      "You are a fantasy football waiver wire analyst. You read this week's published waiver columns and community threads and report their consensus faithfully, with the disagreements kept visible. You never invent a player, a role change, or a bid.",
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: SEARCH_USES }],
    messages,
  });
  for (let resumes = 0; response.stop_reason === "pause_turn" && resumes < 4; resumes++) {
    messages.push({ role: "assistant", content: response.content });
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 12000,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: SEARCH_USES }],
      messages,
    });
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Waiver research was refused by the model");
  }

  // A paused turn leaves its text in the resumed history, not in the final
  // response; the first version read only the final response and got an
  // empty dynasty list out of a run that had found six sources.
  const textOf = (content: Anthropic.MessageParam["content"] | Anthropic.ContentBlock[]): string =>
    typeof content === "string"
      ? content
      : content
          .filter((b): b is Anthropic.TextBlock => typeof b === "object" && b.type === "text")
          .map((b) => b.text)
          .join("\n");
  const prose = [
    ...messages.filter((m) => m.role === "assistant").map((m) => textOf(m.content)),
    textOf(response.content),
  ]
    .join("\n")
    .trim();
  if (!prose) throw new Error("Waiver research returned no text");

  const extract = async (instruction: string) => {
    const parsed = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low", format: zodOutputFormat(ResearchSchema) },
      messages: [{ role: "user", content: `${instruction}\n\n${prose}` }],
    });
    return parsed.parsed_output;
  };
  let out = await extract(
    "Extract every recommended player from the research below into the schema. faabPercent is the consensus bid as a percent of the ORIGINAL budget, taken from the FAAB line (a $12 bid on $100 is 12; a $150 bid on $1000 is 15); use null only when the research says no source gave a bid. Keep the note to one or two sentences about the role change. Use the NFL team abbreviation Sleeper uses (JAX not JAC, LAR, LAC, KC, GB, NE, NO, SF, TB, WAS, LV, ARI, ATL, BAL, BUF, CAR, CHI, CIN, CLE, DAL, DEN, DET, HOU, IND, MIA, MIN, NYG, NYJ, PHI, PIT, SEA, TEN).",
  );
  if (!out || out.targets.length === 0) {
    out = await extract(
      "The text below is fantasy football waiver research. List every player it recommends claiming, one entry each, with the tier that best fits the description and the FAAB percent if one is stated (null otherwise). Do not return an empty list if the text names any players.",
    );
  }
  if (!out || out.targets.length === 0) {
    // Keep what the model wrote so the failure can be read back, then fail
    // loudly: an empty list must never be cached as this week's answer.
    try {
      await redis.set(
        `${KEY(season, week, format)}:debug`,
        { stopReason: response.stop_reason, prose: prose.slice(0, 6000), at: new Date().toISOString() },
        { ex: 2 * 24 * 60 * 60 },
      );
    } catch {
      /* the error below is the one that matters */
    }
    throw new Error(out ? "Waiver research named no players" : "Waiver research could not be parsed");
  }

  const result: WaiverResearch = {
    season,
    week,
    format,
    generatedAt: new Date().toISOString(),
    targets: out.targets,
    sources: out.sources,
    proseExcerpt: prose.slice(0, 4000),
  };
  await redis.set(KEY(season, week, format), result, { ex: RESEARCH_TTL });
  return result;
}
