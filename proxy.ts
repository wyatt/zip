import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";

// UI gates provide sign-in in context. Every data query and mutation enforces its own role checks.
export default convexAuthNextjsMiddleware(undefined, { cookieConfig: { maxAge: 7 * 86400 } });
export const config = { matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api)(.*)"] };
