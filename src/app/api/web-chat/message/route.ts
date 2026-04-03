import { type NextRequest, NextResponse } from "next/server";
import { handleWebChatMessage } from "~/engine/web-chat/index";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Parameters<typeof handleWebChatMessage>[0];
    const result = await handleWebChatMessage(body);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[web-chat] unhandled error:", message);
    return NextResponse.json({ success: false, error: "internal_error", detail: message }, { status: 500 });
  }
}
