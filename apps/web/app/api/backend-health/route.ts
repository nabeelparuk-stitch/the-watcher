import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (!apiUrl) {
    return NextResponse.json({
      ok: false,
      error: "NEXT_PUBLIC_API_URL is not set on Vercel (Settings → Environment Variables).",
    });
  }

  if (/localhost|127\.0\.0\.1/i.test(apiUrl)) {
    return NextResponse.json({
      ok: false,
      apiUrl,
      error:
        "NEXT_PUBLIC_API_URL points to localhost. Set it to your public API URL (e.g. Railway), then redeploy.",
    });
  }

  try {
    const res = await fetch(`${apiUrl}/health`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({
      ok: res.ok,
      apiUrl,
      health: body,
      status: res.status,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      apiUrl,
      error: `Cannot reach API: ${message}. Deploy the API (Railway/Fly) and check the URL.`,
    });
  }
}
