import { NextResponse } from "next/server";
import { find } from "@/lib/search";

export const maxDuration = 60;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q") ?? "";
  const vid = u.searchParams.get("vid") ?? undefined;
  const k = Number(u.searchParams.get("k") ?? 5);
  try {
    return NextResponse.json(await find(q, vid, k));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
