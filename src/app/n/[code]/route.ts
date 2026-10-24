import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isShortCode } from "@/lib/domain/news";
import { errorResponse } from "@/lib/server/http";

export const runtime = "nodejs";

/** Short link from a WhatsApp news message (SPEC §15.10): redirects to the article or post. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    await requireRole();
    const { code } = await params;
    if (!isShortCode(code)) return new Response("Not found.", { status: 404 });
    const item = await db.newsItem.findUnique({ where: { code }, select: { url: true } });
    // Only ever redirect to http(s) (never javascript: or data:), checked again here.
    if (!item || !/^https?:\/\//i.test(item.url)) return new Response("Not found.", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: item.url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    return errorResponse(e);
  }
}
