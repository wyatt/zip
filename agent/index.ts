import { startFlightAgent } from "./flight-agent";
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const token = process.env.ZIP_AGENT_TOKEN;
if (!url || !token) throw new Error("Configure NEXT_PUBLIC_CONVEX_URL and a provisioned ZIP_AGENT_TOKEN. No default aircraft credentials are provided.");
const agent = await startFlightAgent(url, token);
process.on("SIGINT", () => void agent.shutdown());
process.on("SIGTERM", () => void agent.shutdown());
