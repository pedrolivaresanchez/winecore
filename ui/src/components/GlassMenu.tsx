import type { ComponentProps } from "react";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function GlassMenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      className={cn("glass-menu w-[min(18rem,calc(100vw-1.5rem))] rounded-lg p-1.5", className)}
      {...props}
    />
  );
}
