import { NextRequest, NextResponse } from "next/server";

const ADMIN_PATHS = ["/api/admin"];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!isAdminPath(pathname)) {
    return NextResponse.next();
  }

  if (!ADMIN_PASSWORD) {
    console.warn("ADMIN_PASSWORD not set - admin routes are unprotected");
    return NextResponse.next();
  }
  //not required for devlopment
  
  // const authHeader = req.headers.get("authorization");
  // console.log("authheader: ", authHeader)
  // if (authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
  //   return new NextResponse("Unauthorized", { status: 401 });
  // }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
