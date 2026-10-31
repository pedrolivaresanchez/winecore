import { Link } from "react-router-dom";
import { copy } from "@/i18n";
import { cn } from "@/lib/utils";

export function BrandMark({
  word = "auto",
  className,
}: {
  word?: "always" | "auto" | "never";
  className?: string;
}) {
  return (
    <Link
      to="/"
      className={cn("inline-flex min-h-11 items-center gap-2 rounded-md", className)}
    >
      <svg viewBox="0 0 32 32" className="size-7 shrink-0 text-flame" aria-hidden>
        <rect width="32" height="32" rx="8" fill="currentColor" />
        <path
          fill="var(--on-flame)"
          d="M4 7 L9 25 H13 L16 12 L19 25 H23 L28 7 H24 L21 20 L16.8 8 H15.2 L11 20 L8 7 Z"
        />
      </svg>
      <span
        className={cn(
          "text-body font-semibold tracking-tight",
          word === "never" && "sr-only",
          word === "auto" && "max-sm:sr-only",
        )}
      >
        {copy.appName}
      </span>
    </Link>
  );
}
