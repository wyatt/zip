import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const agent = service("agent", {
    source: github("wyatt/zip", { branch: "main" }),
    start: "npx tsx agent/index.ts",
    healthcheck: "/health",
    env: {
      IRIS_AGENT_TOKEN: preserve(),
      IRIS_ALLOWED_ORIGIN: preserve(),
      IRIS_CONTROL_BIND: preserve(),
      NEXT_PUBLIC_CONVEX_URL: preserve(),
    },
  });

  const web = service("web", {
    source: github("wyatt/zip", { branch: "main" }),
    start: "npx next start -H 0.0.0.0 -p $PORT",
    env: {
      NEXT_PUBLIC_CONTROL_URL: preserve(),
      NEXT_PUBLIC_CONVEX_SITE_URL: preserve(),
      NEXT_PUBLIC_CONVEX_URL: preserve(),
    },
  });

  return project("lift", {
    resources: [web, agent],
  });
});
