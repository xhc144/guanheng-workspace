export const dynamic = "force-dynamic";

// No brand asset is supplied. Return an empty HTTP response, never a generated image.
export function GET() {
  return new Response(null, { status: 204, headers: {
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  } });
}

export const HEAD = GET;
