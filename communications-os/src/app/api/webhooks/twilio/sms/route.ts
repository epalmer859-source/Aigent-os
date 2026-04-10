import { type NextRequest, NextResponse } from "next/server";
import { handleInboundSms } from "~/engine/webhooks/index";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const payload = Object.fromEntries(formData.entries());
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const url = request.url;

  const result = await handleInboundSms(
    payload as unknown as Parameters<typeof handleInboundSms>[0],
    signature,
    url,
  );

  let status = 200;
  if (!result.success) {
    if (result.error?.includes("403")) status = 403;
    else if (result.error?.includes("404")) status = 404;
    else status = 400;
  }

  return new NextResponse(result.twiml, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}
