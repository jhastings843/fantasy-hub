import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { friendlyAiError } from "@/lib/ai-errors";

// Turning a photo of the pool's board into rows.
//
// The small pool lives on a site with no API and no useful copy and paste: the
// picks are team LOGOS in a grid, so the text behind them says nothing. A
// screenshot is the only export it has. This reads one.
//
// Haiku rather than Opus on purpose. The job is transcription, not judgment:
// read the grid, write the abbreviations, invent nothing. A screenshot of a
// ten row board costs a fifth of a cent, which matters because the whole point
// of the exercise is a weekly habit rather than a one-off.
const MODEL = "claude-haiku-4-5-20251001";

const PROMPT = `This is a screenshot of a survivor pool board. Each row is one entry: a person's name, then one NFL team per week column, left to right, earliest week first. The teams are shown as logos.

Return one line per row, in the order they appear:

Name TEAM TEAM TEAM

Rules:
- Use standard NFL abbreviations: ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS.
- One line per entry, no header, no numbering, no commentary.
- If a week's cell is empty for an entry, stop that line there rather than guessing.
- If you cannot identify a logo with confidence, write ?? in its place.
- Do not include rows that are not entries, such as filter buttons or page counters.`;

export interface BoardRead {
  ok: boolean;
  text?: string;
  error?: string;
  /** What it could not identify, so the caller can say so rather than hide it. */
  unreadable?: number;
}

/**
 * Read a board screenshot.
 *
 * The image is passed straight through as base64 and never stored: what comes
 * back is text, and the text is what gets saved.
 */
export async function readBoardImage(
  base64: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp",
): Promise<BoardRead> {
  try {
    const client = new Anthropic({ timeout: 60_000 });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system:
        "You transcribe fantasy sports tables exactly as they appear. You never infer a pick that is not shown and never reorder rows.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) return { ok: false, error: "Nothing came back from the read." };

    return { ok: true, text, unreadable: (text.match(/\?\?/g) ?? []).length };
  } catch (e) {
    return {
      ok: false,
      error: friendlyAiError(e) ?? (e instanceof Error ? e.message : "The read failed."),
    };
  }
}
