import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { madridInputToIso, parseSpanishDate, spanishDate, spanishTime } from "@/pages/existencias/time";

export function AtField({ iso, onChange, label = "Existencias a" }: { iso: string; onChange: (iso: string) => void; label?: string }) {
  const [dateText, setDateText] = useState(() => spanishDate(iso));
  const [timeText, setTimeText] = useState(() => spanishTime(iso));
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement === dateRef.current || document.activeElement === timeRef.current) return;
    setDateText(spanishDate(iso));
    setTimeText(spanishTime(iso));
  }, [iso]);

  function commit(nextDate: string, nextTime: string) {
    const date = parseSpanishDate(nextDate);
    const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(nextTime.trim());
    if (!date || !time) {
      setDateText(spanishDate(iso));
      setTimeText(spanishTime(iso));
      return;
    }
    onChange(madridInputToIso(`${date}T${time[1]}:${time[2]}`));
  }

  function blur(nextDate: string, nextTime: string) {
    window.setTimeout(() => {
      if (document.activeElement === dateRef.current || document.activeElement === timeRef.current) return;
      commit(nextDate, nextTime);
    }, 0);
  }

  return (
    <fieldset className="grid min-w-0 gap-1">
      <legend className="text-compact font-medium">{label}</legend>
      <div className="flex min-w-0 gap-2">
        <Input
          ref={dateRef}
          aria-label={`${label}, fecha`}
          inputMode="numeric"
          placeholder="dd/mm/aaaa"
          value={dateText}
          className="w-[9.5rem] max-w-[60%]"
          onChange={(event) => setDateText(event.target.value)}
          onBlur={() => blur(dateText, timeText)}
        />
        <Input
          ref={timeRef}
          aria-label={`${label}, hora`}
          inputMode="numeric"
          placeholder="hh:mm"
          value={timeText}
          className="w-[5.5rem]"
          onChange={(event) => setTimeText(event.target.value)}
          onBlur={() => blur(dateText, timeText)}
        />
      </div>
    </fieldset>
  );
}

export function MadridDateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const shown = value.length === 10 ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : "";
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(shown);
  }, [focused, shown]);

  return (
    <Input
      id={id}
      aria-label={label}
      inputMode="numeric"
      placeholder="dd/mm/aaaa"
      value={text}
      className="h-11 w-36 shrink-0 md:h-8"
      onFocus={() => setFocused(true)}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        setFocused(false);
        const trimmed = text.trim();
        if (!trimmed) {
          onChange("");
          return;
        }
        const parsed = parseSpanishDate(trimmed);
        if (!parsed) {
          setText(shown);
          return;
        }
        onChange(parsed);
      }}
    />
  );
}
