import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { copy } from "@/i18n";

export function Mas() {
  return (
    <div data-screen="mas" className="flex flex-col gap-6">
      <PageHeader title={copy.more.title} description={copy.more.description} />
      <EmptyState title={copy.more.empty} description={copy.more.emptyHint} />
    </div>
  );
}
