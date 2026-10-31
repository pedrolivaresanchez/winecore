import { BrandMark } from "@/components/BrandMark";
import { EntitySwitcher } from "@/app/EntitySwitcher";
import { UserMenu } from "@/app/UserMenu";
import type { Me } from "@/lib/types";

export function Header({ me }: { me: Me }) {
  return (
    <header
      className="sticky top-0 z-30 border-b bg-background"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 min-w-0 items-center gap-2 px-3 md:px-4">
        <BrandMark word="always" className="shrink-0 md:hidden" />
        <div className="min-w-0">
          <EntitySwitcher />
        </div>
        <div className="ml-auto shrink-0">
          <UserMenu me={me} />
        </div>
      </div>
    </header>
  );
}
