"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useMe } from "@/lib/identity";
import { SignInLink, SignOutLink } from "./SignIn";

const NAV = [
  { href: "/", label: "세션" },
  { href: "/prompts", label: "모델" },
  { href: "/optimize", label: "학습" },
];

export function Header() {
  const me = useMe();
  const pathname = usePathname();

  return (
    <header className="flex items-center justify-between gap-4 py-5">
      <div className="flex items-center gap-6">
        <Link
          href="/"
          className="text-[15px] font-semibold tracking-tight transition-colors hover:text-muted-foreground"
        >
          prompt<span className="text-muted-foreground">grad</span>
        </Link>
        <nav className="flex items-center gap-4">
          {NAV.map((n) => {
            const active =
              n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "text-[13px] transition-colors hover:text-foreground",
                  active ? "text-foreground font-medium" : "text-muted-foreground"
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <nav className="flex items-center gap-4">
        {me === undefined ? (
          <span aria-hidden className="opacity-0">
            ·
          </span>
        ) : me ? (
          <>
            <span className="hidden text-[13px] text-muted-foreground sm:inline">
              {me.display_name}
            </span>
            <SignOutLink />
          </>
        ) : (
          <SignInLink size="sm" />
        )}
      </nav>
    </header>
  );
}
