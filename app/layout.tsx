import type { Metadata } from "next";
import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "@fontsource/lato/900.css";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "./map.css";
import "./operations.css";
import { Providers } from "./providers";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
export const metadata: Metadata = { title: "zip · flight operations", description: "Request a job, coordinate operators, and follow live flight operations." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><ConvexAuthNextjsServerProvider><Providers>{children}</Providers></ConvexAuthNextjsServerProvider></body></html>;
}
