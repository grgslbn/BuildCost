import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // NEXT_PUBLIC_ vars are inlined at build time in client bundles but may not
  // propagate to the edge at runtime. Check both variants so setting either
  // NEXT_PUBLIC_SKIP_AUTH=true or SKIP_AUTH=true in Vercel is sufficient.
  const skipAuth =
    process.env.NEXT_PUBLIC_SKIP_AUTH === "true" ||
    process.env.SKIP_AUTH === "true";
  console.log("[middleware] skip-auth check", {
    NEXT_PUBLIC_SKIP_AUTH: process.env.NEXT_PUBLIC_SKIP_AUTH,
    SKIP_AUTH: process.env.SKIP_AUTH,
    skipping: skipAuth,
    path: request.nextUrl.pathname,
  });
  if (skipAuth) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
