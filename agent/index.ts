import { startFlightAgent } from "./flight-agent";
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const token = process.env.IRIS_AGENT_TOKEN;
if (!url || !token) throw new Error("Configure NEXT_PUBLIC_CONVEX_URL and a provisioned IRIS_AGENT_TOKEN for the operator fleet. No default aircraft credentials are provided.");
const agent = await startFlightAgent(url, token);
process.on("SIGINT", () => void agent.shutdown());
process.on("SIGTERM", () => void agent.shutdown());
