import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { hashSecret } from "./access";

function randomToken(prefix: string) {
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}

export const inviteOperator = action({ args: { email: v.string() }, handler: async (ctx, { email }): Promise<{ token: string; expiresAt: number }> => {
  const token = randomToken("zip_invite_");
  const tokenHash = await hashSecret(token);
  const result = await ctx.runMutation(internal.accounts.storeInvite, { email, tokenHash });
  return { token, ...result };
} });
export const issueAgentCredential = action({ args: { vehicleId: v.id("vehicles") }, handler: async (ctx, { vehicleId }): Promise<{ token: string; expiresAt: number }> => {
  const token = randomToken("zip_agent_");
  const tokenHash = await hashSecret(token);
  const result = await ctx.runMutation(internal.fleet.storeCredential, { vehicleId, tokenHash });
  return { token, ...result };
} });
