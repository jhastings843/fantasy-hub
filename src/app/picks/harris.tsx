import { harrisNow } from "@/lib/picks/harris";
import { recText } from "@/lib/picks/harris-track";
import s from "./picks.module.css";

// John Harris (@jhnhrris), tracked on the college research view. Never used
// for a bet: the strategy review files a proposal only if he clears the bar.

export async function HarrisCard() {
  const r = await harrisNow().catch(() => null);
  if (!r || !r.weeks.length) {
    return (
      <section className={s.section} aria-labelledby="harris">
        <h2 className={s.h2} id="harris">John Harris tracker</h2>
        <p className={s.calm}>No sheets on file yet. His Thursday contest post is read automatically.</p>
      </section>
    );
  }
  const a = r.agreement;
  const tiers: [string, keyof typeof r.picks][] = [["Best", "best"], ["Strong", "strong"], ["Games of the week", "gow"], ["Others", "other"], ["All posted picks", "all"]];
  return (
    <section className={s.section} aria-labelledby="harris">
      <div className={s.sectionHead}>
        <div className={s.eyebrow}>{`Tracked, not used · weeks ${r.weeks.join(", ")}`}</div>
        <h2 className={s.h2} id="harris">John Harris tracker</h2>
        <p className={s.p}>
          {r.clears.agreement || r.clears.edge || r.clears.picks
            ? "He has cleared the bar: a proposal is in the strategy journal for a person to decide on."
            : "Graded every week. He joins the rule only if his agreement with Sam and David, or his own edge, clears the same bar any strategy change must."}
        </p>
      </div>
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
          <div className={s.tileK}>{`Does he help Sam + David? ${a.games} games; bar is 30 over 3 weeks at t 1.645`}</div>
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
    </section>
  );
}
