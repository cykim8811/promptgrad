"use client";

import { LogOut } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signInHref, signOutHref } from "@/lib/identity";

export function SignInLink({
  returnTo,
  size = "default",
}: {
  returnTo?: string;
  size?: "sm" | "default" | "lg";
}) {
  return (
    <a
      href={signInHref(returnTo)}
      className={cn(buttonVariants({ size }))}
    >
      Sign in with coders.kr
    </a>
  );
}

export function SignOutLink({ returnTo }: { returnTo?: string }) {
  return (
    <a
      href={signOutHref(returnTo)}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <LogOut className="size-3.5" />
      Sign out
    </a>
  );
}
