// The Ledger faces are site wide (globals.css, 2026-10-22), so this layout only keeps the column.
export default function PicksLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col">{children}</div>;
}
