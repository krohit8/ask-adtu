import { NextResponse } from "next/server";
import { getHistory } from "@/lib/session/memory";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const history = getHistory(sessionId);
  return NextResponse.json({ history });
}
