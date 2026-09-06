"use client";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import type { ReactNode } from "react";
import { homeFor, type Account } from "./auth-gate";
import { isCustomerRole, isDemoRole, isOperatorRole } from "@/lib/roles";

export function AppShell({ account, surface, children }: { account: Account; surface: "customer" | "operator" | "fleet" | "settings"; children: ReactNode }) {
  const { signOut } = useAuthActions();
  const role = account.member?.role ?? "customer";
  const home = homeFor(role);
  const customerNav = isCustomerRole(role);
  const operatorNav = isOperatorRole(role);
  const demo = isDemoRole(role);
  const wordmarkRole = demo ? " | Demo" : role !== "customer" ? " | Pilot" : "";
  return <><header className="header"><Link className="wordmark" href={home} aria-label={demo ? "iris Demo home" : role === "customer" ? "iris home" : "iris Pilot home"}>iris{wordmarkRole && <span className="wordmark-role">{wordmarkRole}</span>}</Link><nav aria-label="Workspace">{customerNav && <Link href="/request" aria-current={surface === "customer" ? "page" : undefined}>Requests</Link>}{operatorNav && <><Link href="/operator" aria-current={surface === "operator" ? "page" : undefined}>Dashboard</Link><Link href="/fleet" aria-current={surface === "fleet" ? "page" : undefined}>Fleet</Link><Link href="/settings" aria-current={surface === "settings" ? "page" : undefined}>Settings</Link></>}</nav><div className="account-menu"><span>{account.member?.displayName}{demo ? " · Demo" : ""}</span><a href="/" onClick={(event) => { event.preventDefault(); void signOut(); }}>Sign out</a></div></header>{children}</>;
}
