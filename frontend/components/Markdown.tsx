"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Minimal, readable markdown rendering for generated explanations.
 * No typography plugin — element styles are mapped explicitly so the
 * output stays in the app's greyscale palette.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div
      className={cn(
        "text-[15px] leading-relaxed text-foreground",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-6 mb-2 text-xl font-semibold" {...p} />,
          h2: (p) => <h2 className="mt-6 mb-2 text-lg font-semibold" {...p} />,
          h3: (p) => <h3 className="mt-5 mb-2 text-base font-semibold" {...p} />,
          p: (p) => <p className="my-3" {...p} />,
          ul: (p) => <ul className="my-3 list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="my-3 list-decimal space-y-1 pl-5" {...p} />,
          li: (p) => <li className="leading-relaxed" {...p} />,
          a: (p) => (
            <a
              className="font-medium underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
              {...p}
            />
          ),
          blockquote: (p) => (
            <blockquote
              className="my-3 border-l-2 border-border pl-4 text-muted-foreground"
              {...p}
            />
          ),
          code: ({ className, children, ...rest }) => {
            const inline = !String(className ?? "").includes("language-");
            if (inline)
              return (
                <code
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
                  {...rest}
                >
                  {children}
                </code>
              );
            return (
              <code className={cn("font-mono text-[0.85em]", className)} {...rest}>
                {children}
              </code>
            );
          },
          pre: (p) => (
            <pre
              className="my-3 overflow-x-auto rounded-md border bg-muted/50 p-3 text-[0.85em]"
              {...p}
            />
          ),
          table: (p) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...p} />
            </div>
          ),
          th: (p) => (
            <th className="border px-3 py-1.5 text-left font-medium" {...p} />
          ),
          td: (p) => <td className="border px-3 py-1.5 align-top" {...p} />,
          hr: () => <hr className="my-5 border-border" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
