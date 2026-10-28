import { harrisNow } from "@/lib/picks/harris";
import { recText } from "@/lib/picks/harris-track";
import { loadActivePolicy } from "@/lib/picks/policy-store";
import { sourceState } from "@/lib/picks/policy";
import { redisStore } from "@/lib/picks/learning/store";
import s from "./picks.module.css";

// John Harris (@jhnhrris), a collapsed panel on the college research view,
// between PEM and the game log. The strategy review adds him as a veto or
// drops him on forward evidence (learning/model.ts "source").

export async function HarrisCard() {
  const [r, policy, state] = await Promise.all([harrisNow().catch(() => null), loadActivePolicy().catch(() => null), redisStore.state().catch(() => null)]);
  const inUse = policy ? sourceState(policy, "harris") : "out";
  const verdict = state?.decisions?.find((d) => d.id === "cfb:source:harris")?.why;
  const status = inUse === "veto" ? "In use: a rule bet he disagrees with is skipped" : "Tracked, not used";
  if (!r || !r.weeks.length) {
    return (
      <details className={s.details}>
        <summary>John Harris tracker</summary>
        <div className={s.detailsBody}>
          <p className={s.calm}>No sheets on file yet. His Thursday contest post is read automatically.</p>
        </div>
      </details>
    );
  }
  const a = r.agreement;
  const tiers: [string, keyof typeof r.picks][] = [["Best", "best"], ["Strong", "strong"], ["Games of the week", "gow"], ["Others", "other"], ["All posted picks", "all"]];
  return (
    <details className={s.details}>
      <summary>{`John Harris tracker · ${inUse === "veto" ? "in use" : "tracked, not used"}`}</summary>
      <div className={s.detailsBody} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className={s.eyebrow}>{`${status} · weeks ${r.weeks.join(", ")}`}</div>
        <p className={s.p}>
          {`The strategy review checks him the morning after every slate on the college rule's bets since its last switch: if skipping the games he disagrees with clearly makes money (30+ bets over 3+ weeks, t 1.645), he is added as a veto; if it clearly costs money, he is dropped. ${verdict ? `Latest: ${verdict}.` : "First check at the next review."}`}
        </p>
        <div className={s.tiles}>
          <div className={s.tile}>
            <div className={`${s.tileV} ${s.num}`}>{recText(r.picks.all)}</div>
            <div className={s.tileK}>His posted picks, at his listed lines</div>
          </div>
          <div className={s.tile}>
            <div className={`${s.tileV} ${s.num}`}>{recText(r.sheet.all)}</div>
            <div className={s.tileK}>{`Full sheet, ${r.sheet.games} games`}</div>
          </div>
          <div className={s.tile}>
            <div className={`${s.tileV} ${s.num}`}>{recText(r.sheet.edge3)}</div>
            <div className={s.tileK}>His 3+ point edges</div>
          </div>
          <div className={`${s.tile} ${a.meanGain > 0 ? s.good : ""}`}>
            <div className={`${s.tileV} ${s.num}`}>{a.games ? `t ${a.t}` : "n/a"}</div>
            <div className={s.tileK}>{`Season so far: does he help Sam + David? ${a.games} games`}</div>
          </div>
        </div>
        <dl className={s.kv}>
          {tiers.map(([label, k]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd className={s.num}>{recText(r.picks[k])}</dd>
            </div>
          ))}
          <dt>Sam + David agree</dt>
          <dd className={s.num}>{`${recText(a.all)} · he agrees ${recText(a.harrisAgrees)} · he disagrees ${recText(a.harrisDisagrees)}`}</dd>
        </dl>
        <p className={s.thin}>{`Sheet lines are the lines on his sheet when posted; picks grade at the line he listed. Not yet gradable: ${r.ungraded.rows} sheet games, ${r.ungraded.picks} picks.`}</p>
      </div>
    </details>
  );
}
