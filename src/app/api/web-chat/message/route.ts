import { type NextRequest, NextResponse } from "next/server";
import { handleWebChatMessage } from "~/engine/web-chat/index";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Parameters<typeof handleWebChatMessage>[0];
  const result = await handleWebChatMessage(body);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
