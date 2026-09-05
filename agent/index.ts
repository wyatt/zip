import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { SimulatorAdapter } from "./simulator";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("Run npm run backend first to create .env.local.");
const client = new ConvexClient(url);
const adapter = new SimulatorAdapter();
const identity = await adapter.connect();
if (!identity.ready) throw new Error("Simulator is not ready.");
const droneId = await client.mutation(api.dispatch.seed, {});
await client.mutation(api.dispatch.heartbeat, { droneId });
console.log(`${identity.identity} connected · simulated only`);
const heartbeat = setInterval(() => { void client.mutation(api.dispatch.heartbeat, { droneId }).catch(fatal); }, 5000);
let busy = false;
const unsubscribe = client.onUpdate(api.dispatch.agentWork, { droneId }, work => {
  if (!work || busy || work.mission.error) return;
  busy = true;
  void (async () => {
    adapter.loadMission(work.mission.route, work.mission.taskType);
    if (work.mission.state === "assigned") {
      await client.mutation(api.dispatch.ready, { missionId: work.mission._id });
      console.log(`Mission ${work.mission._id} ready`);
    } else if (work.command?.status === "pending") {
      const commandId = work.command._id;
      if (!await client.mutation(api.dispatch.acceptCommand, { commandId })) return;
      try {
        console.log(`Mission ${work.mission._id} started`);
        await adapter.start(async snapshot => { await client.mutation(api.dispatch.publish, { commandId, snapshot }); });
        await client.mutation(api.dispatch.complete, { commandId });
        console.log(`Mission ${work.mission._id} landed and completed`);
      } catch (error) {
        await client.mutation(api.dispatch.fail, { commandId, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }
  })().catch(fatal).finally(() => { busy = false; });
}, fatal);
function fatal(error: unknown) { console.error(error); process.exitCode = 1; void shutdown(); }
async function shutdown() { clearInterval(heartbeat); unsubscribe(); await client.close(); }
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
