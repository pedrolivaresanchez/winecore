import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { litresText, parseLitres, parseUnits, unitsText } from "@/pages/existencias/volume";

function DecimalField({
  id,
  textOf,
  parse,
  value,
  onCommit,
  disabled,
  invalid,
  label,
}: {
  id: string;
  textOf: (value: number) => string;
  parse: (text: string) => number | null | undefined;
  value: number | null;
  onCommit: (value: number | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
}) {
  const [text, setText] = useState(value == null ? "" : textOf(value));
  const [focused, setFocused] = useState(false);
  const [localError, setLocalError] = useState(false);

  useEffect(() => {
    if (!focused) setText(value == null ? "" : textOf(value));
  }, [focused, textOf, value]);

  return (
    <Input
      id={id}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || localError || undefined}
      disabled={disabled}
      value={text}
      className="md:h-9"
      onFocus={() => setFocused(true)}
      onChange={(event) => {
        setText(event.target.value);
        setLocalError(false);
      }}
      onBlur={() => {
        setFocused(false);
        const parsed = parse(text);
        if (parsed === undefined) {
          setLocalError(true);
          return;
        }
        setLocalError(false);
        onCommit(parsed);
        setText(parsed == null ? "" : textOf(parsed));
      }}
    />
  );
}

export function VolumeInput({
  id,
  ml,
  onCommit,
  disabled,
  invalid,
  label = "Litros contados",
}: {
  id: string;
  ml: number | null;
  onCommit: (ml: number | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
}) {
  return (
    <DecimalField
      id={id}
      textOf={litresText}
      parse={parseLitres}
      value={ml}
      onCommit={onCommit}
      disabled={disabled}
      invalid={invalid}
      label={label}
    />
  );
}

export function UnitsInput({
  id,
  units,
  onCommit,
  disabled,
  invalid,
  label = "Unidades contadas",
}: {
  id: string;
  units: number | null;
  onCommit: (units: number | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
}) {
  return (
    <DecimalField
      id={id}
      textOf={unitsText}
      parse={parseUnits}
      value={units}
      onCommit={onCommit}
      disabled={disabled}
      invalid={invalid}
      label={label}
    />
  );
}
