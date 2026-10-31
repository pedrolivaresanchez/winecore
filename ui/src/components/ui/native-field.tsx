import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const control =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-compact text-foreground outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-9";

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(control, "h-auto min-h-24 py-2 md:min-h-24", className)}
      {...props}
    />
  );
}
