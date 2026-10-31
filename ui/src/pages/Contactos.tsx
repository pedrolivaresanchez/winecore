import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { copy } from "@/i18n";

export function Contactos() {
  return (
    <div data-screen="contactos" className="flex flex-col gap-6">
      <PageHeader title={copy.contacts.title} description={copy.contacts.description} />
      <EmptyState title={copy.contacts.empty} description={copy.contacts.emptyHint} />
    </div>
  );
}
