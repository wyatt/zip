"use client";
import { useState, type ReactNode } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type Account = NonNullable<FunctionReturnType<typeof api.accounts.me>>;
export function AuthGate({ children }: { children: (account: Account) => ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const account = useQuery(api.accounts.me, isAuthenticated ? {} : "skip");
  if (isLoading || (isAuthenticated && account === undefined)) return <div className="auth-card panel"><h1>zip<span>.</span></h1><p>Loading your workspace…</p></div>;
  if (!isAuthenticated || !account) return <SignIn />;
  if (!account.member) return <AccountSetup />;
  return children(account);
}
function AccountSetup() {
  const setup = useMutation(api.accounts.setup);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <section className="auth-card panel"><p className="eyebrow">WELCOME TO ZIP</p><h1>Your workspace</h1><p className="muted">Add your name to finish setting up your account.</p><form onSubmit={async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError("");
    try { await setup({ displayName: String(data.get("name")) }); } catch { setError("Could not save your account. Please try again."); } finally { setBusy(false); }
  }}><label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={80} /></label><button className="primary" disabled={busy}>Open workspace</button>{error && <p role="alert" className="error">{error}</p>}</form></section>;
}
function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp" | "reset" | "reset-verification">("signIn");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const title = flow === "signIn" ? "Welcome back" : flow === "signUp" ? "Create your account" : "Reset your password";
  return <main className="auth-card panel"><a className="wordmark" href="/request">zip<span>.</span></a><p className="eyebrow">FLIGHT OPERATIONS</p><h1>{title}</h1><p className="muted">One account for your requests. Approved operators get access to dispatch and aircraft controls.</p><form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget); data.set("flow", flow);
    try { await signIn("password", data); if (flow === "reset") setFlow("reset-verification"); }
    catch { setError(flow === "reset" ? "Recovery email could not be sent. Contact your administrator if this persists." : "Could not sign in. Check your details and try again."); }
    finally { setBusy(false); }
  }}><label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
    {flow === "reset-verification" && <label>Reset code<input name="code" autoComplete="one-time-code" required /><small className="muted">Enter the code from your recovery email.</small></label>}
    {flow !== "reset" && <label>{flow === "reset-verification" ? "New password" : "Password"}<input aria-label={flow === "reset-verification" ? "New password" : "Password"} name={flow === "reset-verification" ? "newPassword" : "password"} type="password" autoComplete={flow === "signIn" ? "current-password" : "new-password"} required minLength={flow === "signIn" ? undefined : 12} maxLength={128} />{flow === "signUp" && <small className="muted">At least 12 characters.</small>}</label>}
    <button className="primary" disabled={busy}>{busy ? "Please wait…" : flow === "signIn" ? "Sign in" : flow === "signUp" ? "Create account" : flow === "reset" ? "Send recovery code" : "Save new password"}<span>↗</span></button>
    {error && <p className="error" role="alert">{error}</p>}
  </form><div className="auth-links"><button className="text-button" onClick={() => { setFlow(flow === "signIn" ? "signUp" : "signIn"); setError(""); }}>{flow === "signIn" ? "Create an account" : "Back to sign in"}</button>{flow === "signIn" && <button className="text-button" onClick={() => { setFlow("reset"); setError(""); }}>Forgot password?</button>}</div></main>;
}
