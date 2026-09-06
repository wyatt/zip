"use client";
import { AuthGate, homeFor, WorkspaceSplash } from "@/components/auth-gate";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  return <AuthGate>{account => <HomeRedirect href={homeFor(account.member!.role)} />}</AuthGate>;
}
function HomeRedirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(href); }, [href, router]);
  return <WorkspaceSplash />;
}
