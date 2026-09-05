"use client";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import type { ReactNode } from "react";
import type { Account } from "./auth-gate";

export function AppShell({ account, surface, children }: { account: Account; surface: "customer" | "operator" | "fleet"; children: ReactNode }) {
  const { signOut } = useAuthActions();
  return <><header className="header"><Link className="wordmark" href="/request" aria-label="zip home">zip<span>.</span></Link><nav aria-label="Workspace"><Link href="/request" aria-current={surface === "customer" ? "page" : undefined}>Customer</Link><Link href="/operator" aria-current={surface === "operator" ? "page" : undefined}>Operator</Link>{account.operator?.approved && <Link href="/fleet" aria-current={surface === "fleet" ? "page" : undefined}>Aircraft</Link>}</nav><div className="account-menu"><span>{account.member?.displayName}</span><button className="text-button" onClick={() => void signOut()}>Sign out</button></div></header>{children}</>;
}
