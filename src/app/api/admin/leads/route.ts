import { NextResponse } from "next/server";
import * as store from "@/db/store";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? 100);
  const offset = Number(searchParams.get("offset") ?? 0);

  const { leads, total } = await store.getLeads({ status, limit, offset });
  return NextResponse.json({ leads, total });
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, contactStatus, phoneNumber } = body as {
      id: number;
      contactStatus?: "pending" | "contacted" | "completed";
      phoneNumber?: string;
    };

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    let updated = false;
    if (contactStatus) {
      updated = await store.updateLeadStatus(id, contactStatus);
    }
    if (phoneNumber !== undefined) {
      updated = (await store.updateLeadPhone(id, phoneNumber)) || updated;
    }

    if (!updated) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
}
