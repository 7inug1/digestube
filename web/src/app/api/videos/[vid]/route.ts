import { NextResponse } from "next/server";
import { removeVideo } from "@/lib/store";

/** 영상 삭제. 전사가 중간에 끊겨 문단이 없는 행이 남는 일이 있어 화면에서
    치울 수 있어야 한다. 문단·목차는 외래키로 같이 지워진다. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ vid: string }> },
) {
  const { vid } = await params;
  try {
    await removeVideo(vid);
    return NextResponse.json({ ok: true, vid });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
