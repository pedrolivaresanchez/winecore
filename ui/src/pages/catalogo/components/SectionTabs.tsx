import { NativeSelect } from "@/components/ui/native-field";

export function SectionTabs<T extends string>({
  id,
  label,
  tabs,
  value,
  onChange,
}: {
  id: string;
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <>
      <div className="md:hidden">
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="hidden flex-wrap gap-2 md:flex" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={value === tab.id}
            className={`h-11 rounded-full px-3 text-compact md:h-8 ${value === tab.id ? "bg-ink text-ink-foreground" : "bg-muted"}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  );
}
