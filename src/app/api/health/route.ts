import { NextResponse } from "next/server";
import * as store from "@/db/store";

export async function GET() {
  try {
    const count = store.isReady() ? store.getChunks().length : 0;
    return NextResponse.json({ ok: true, chunks: count });
  } catch {
    return NextResponse.json({ ok: false, chunks: 0 }, { status: 503 });
  }
}
