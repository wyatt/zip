"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState } from "react";
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => process.env.NEXT_PUBLIC_CONVEX_URL ? new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL) : null);
  if (!client) return <main className="setup"><h1>zip</h1><h2>Connect the local demo</h2><p>Run <code>npm run backend</code>, then restart the Next.js server.</p></main>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
