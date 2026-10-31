import { useId, type ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { copy } from "@/i18n";
import { cn } from "@/lib/utils";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "start" | "end";
  /** Si alguna columna lo marca, la tarjeta móvil usa solo esas (máximo 3). */
  card?: boolean;
};

function cardColumns<T>(columns: Column<T>[]): Column<T>[] {
  const marked = columns.filter((column) => column.card);
  if (marked.length > 0) return marked.slice(0, 3);
  return columns.slice(0, 3);
}

export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  search,
  onSearchChange,
  searchPlaceholder = copy.table.search,
  onRowClick,
  selectedKey,
  loading = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
}) {
  const searchId = useId();
  const cards = cardColumns(columns);

  return (
    <div className="flex flex-col gap-3">
      {onSearchChange ? (
        <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 border-b bg-background px-4 py-3 md:-mx-6 md:px-6">
          <label className="sr-only" htmlFor={searchId}>
            {searchPlaceholder}
          </label>
          <Input
            id={searchId}
            type="search"
            value={search ?? ""}
            placeholder={searchPlaceholder}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      ) : null}

      {loading ? (
        <div aria-busy="true">
          <p className="sr-only">{copy.loading}</p>
          <div className="hidden md:grid md:gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
          <ul className="grid gap-3 md:hidden">
            {Array.from({ length: 3 }, (_, index) => (
              <li key={index} className="rounded-xl border p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </li>
            ))}
          </ul>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <>
          <div className="hidden overflow-x-auto border border-border md:block">
            <Table>
              <caption className="sr-only">{label}</caption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {columns.map((column) => (
                    <TableHead
                      key={column.id}
                      className={cn(
                        "h-11 border border-border bg-muted text-compact font-medium",
                        column.align === "end" && "text-right",
                      )}
                    >
                      {column.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    data-state={selectedKey === rowKey(row) ? "selected" : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={onRowClick ? "cursor-pointer" : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                  >
                    {columns.map((column) => (
                      <TableCell
                        key={column.id}
                        className={cn(
                          "border border-border text-compact",
                          column.align === "end" && "text-right tabular-nums",
                        )}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {rows.map((row) => {
              const [title, second, third] = cards;
              return (
                <li key={rowKey(row)}>
                  <button
                    type="button"
                    className="w-full rounded-xl border bg-card p-4 text-left card-shadow"
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                  {title ? <p className="text-body font-medium break-words">{title.cell(row)}</p> : null}
                  {second || third ? (
                    <dl className="mt-2 grid gap-1">
                      {[second, third].filter(Boolean).map((column) =>
                        column ? (
                          <div key={column.id} className="flex items-baseline justify-between gap-3">
                            <dt className="text-meta text-muted-foreground">{column.header}</dt>
                            <dd className="min-w-0 text-right text-compact break-words">{column.cell(row)}</dd>
                          </div>
                        ) : null,
                      )}
                    </dl>
                  ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {hasMore ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto sm:self-center"
              onClick={onLoadMore}
              disabled={loadingMore || !onLoadMore}
            >
              {loadingMore ? copy.table.loading : copy.table.loadMore}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
