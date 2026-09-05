import type { CommandAcknowledgment, CommandContext } from "./drone-adapter";

/** Bound transport waits and correlate acknowledgments with the command actually sent.
 * Adapters must honor cancellation before every physical write; a timed-out command
 * has an uncertain outcome and must never be automatically replayed. */
export async function executeAdapterCommand(
  context: CommandContext,
  send: (context: CommandContext) => Promise<CommandAcknowledgment>,
): Promise<CommandAcknowledgment> {
  if (context.signal.aborted) throw new Error("Command aborted.");
  if (context.expiresAt <= Date.now()) throw new Error("Command expired.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (reason: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(); rejectAbort(new Error("Command aborted; reconcile aircraft state.")); };
  context.signal.addEventListener("abort", abort, { once: true });
  timer = setTimeout(() => {
    controller.abort();
    rejectAbort(new Error("Aircraft acknowledgment timed out; reconcile aircraft state."));
  }, Math.max(0, context.expiresAt - Date.now()));
  try {
    const result = await Promise.race([send({ ...context, signal: controller.signal }), cancelled]);
    if (controller.signal.aborted || Date.now() > context.expiresAt) throw new Error("Aircraft acknowledgment arrived after command expiry.");
    if (result.commandId !== context.commandId || !Number.isFinite(result.acknowledgedAt) || result.acknowledgedAt > Date.now() + 1000 || result.acknowledgedAt > context.expiresAt) throw new Error("Aircraft acknowledgment does not match the command.");
    if (!result.accepted) throw new Error(result.reason ?? "Aircraft rejected the command.");
    return result;
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", abort);
  }
}
