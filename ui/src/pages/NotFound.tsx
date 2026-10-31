import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { copy } from "@/i18n";

export function NotFound() {
  return (
    <div data-screen="no-encontrada" className="flex flex-col gap-6">
      <PageHeader title={copy.notFound.title} description={copy.notFound.body} />
      <div>
        <Button asChild>
          <Link to="/">{copy.notFound.back}</Link>
        </Button>
      </div>
    </div>
  );
}
