import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-md border border-border bg-card p-4 text-card-foreground", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
