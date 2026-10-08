import type { League } from "@/lib/picks/parse";
import s from "./picks.module.css";

// Strategy review status (filled in by the learning loop).
export async function LearningPanel({ league }: { league: League }) {
  void league;
  return (
    <section className={s.section} aria-labelledby="learning">
      <h2 className={s.h2} id="learning">Strategy review</h2>
      <p className={s.calm}>Not reviewed yet.</p>
    </section>
  );
}
