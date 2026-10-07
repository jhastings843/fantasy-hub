import { Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

// The Picks tab's own faces, loaded only here.
const barlow = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-barlow" });
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export default function PicksLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${barlow.variable} ${plex.variable} ${plexMono.variable} flex flex-1 flex-col`}>{children}</div>;
}
