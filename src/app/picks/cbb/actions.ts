"use server";

import { createElement, type ReactNode } from "react";
import { getCbbBoard } from "@/lib/models/cbb/store";
import { CbbRowBody } from "./CbbView";

// One college hoops game's numbers, fetched when its row opens (UX pass item 4). Read-only.
export async function loadCbbGame(id: string): Promise<ReactNode> {
  if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id)) throw new Error("Bad game");
  const b = await getCbbBoard();
  const x = b?.days.flatMap((d) => d.rows).find((r) => r.g.id === id);
  if (!x) throw new Error("Game not found");
  return createElement(CbbRowBody, { x });
}
