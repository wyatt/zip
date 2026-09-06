"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { canAccessSurface, homeForRole } from "@/lib/roles";

export type Account = NonNullable<FunctionReturnType<typeof api.accounts.me>>;
export type AccountRole = NonNullable<Account["member"]>["role"];
export const homeFor = homeForRole;

export function WorkspaceSplash() {
  return (
    <div className="iris-splash" role="status" aria-live="polite">
      <p className="iris-splash-mark" aria-hidden="true">{["i", "r", "i", "s"].map((letter, index) => <span key={index} className="iris-splash-letter">{letter}</span>)}</p>
      <p className="iris-splash-tagline">drones for everyone</p>
      <span className="visually-hidden">Loading your workspace</span>
    </div>
  );
}

export function AuthGate({ children, surface }: { children: (account: Account) => ReactNode; surface?: "customer" | "operator" | "fleet" | "settings" }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const account = useQuery(api.accounts.me, isAuthenticated ? {} : "skip");
  if (isLoading || (isAuthenticated && account === undefined)) return <WorkspaceSplash />;
  if (!isAuthenticated || !account) return <SignIn />;
  if (!account.member) return <AccountSetup />;
  const home = homeFor(account.member.role);
  if (surface && !canAccessSurface(account.member.role, surface)) return <Redirect href={home} />;
  return children(account);
}
function Redirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(href); }, [href, router]);
  return <WorkspaceSplash />;
}
function AccountSetup() {
  const setup = useMutation(api.accounts.setup);
  const pathname = usePathname();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const suggested = pathname === "/request" ? "customer" : pathname === "/operator" || pathname === "/fleet" || pathname === "/settings" ? "operator" : "demo";
  return <section className="auth-card panel"><p className="eyebrow">WELCOME TO ZIP</p><h1>Your workspace</h1><p className="muted">Customers request flights. Operators fly them. A demo account can do both.</p><form onSubmit={async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError("");
    const selected = String(data.get("role"));
    const role = selected === "operator" || selected === "demo" ? selected : "customer";
    try { await setup({ displayName: String(data.get("name")), role }); } catch { setError("Could not save your account. Please try again."); } finally { setBusy(false); }
  }}><label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={80} /></label>
    <fieldset><legend>I am a</legend>
      <label className="mode-choice"><input type="radio" name="role" value="demo" defaultChecked={suggested === "demo"} required /><span>Demo<small>Request flights and operate aircraft from the same login.</small></span></label>
      <label className="mode-choice"><input type="radio" name="role" value="customer" defaultChecked={suggested === "customer"} /><span>Customer<small>Request flights and follow the operation.</small></span></label>
      <label className="mode-choice"><input type="radio" name="role" value="operator" defaultChecked={suggested === "operator"} /><span>Operator<small>Register aircraft and accept jobs.</small></span></label>
    </fieldset>
    <button className="primary" disabled={busy}>Open workspace</button>{error && <p role="alert" className="error">{error}</p>}</form></section>;
}
function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp" | "reset" | "reset-verification">("signIn");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const title = flow === "signIn" ? "Welcome back" : flow === "signUp" ? "Create your account" : "Reset your password";
  return <main className="auth-card panel"><a className="wordmark" href="/">iris</a><p className="eyebrow">FLIGHT OPERATIONS</p><h1>{title}</h1><p className="muted">Create a customer, operator, or demo account. Demo accounts can request flights and fly them.</p><form onSubmit={async event => {
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
