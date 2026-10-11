import { useId } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ratioText } from "@/lib/format";

/** An optional 0-1 ratio: a switch turns it on (with a preset) and a slider sets it. Off reads "Not used". */
export function RatioField({ label, value, onChange, preset = 0.5, disabled }: {
  label: string; value: number | undefined; onChange: (value: number | undefined) => void; preset?: number; disabled?: boolean;
}) {
  const id = useId();
  const on = value != null;
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <div className="flex items-center gap-2.5">
        <Switch id={id} checked={on} disabled={disabled} onCheckedChange={(checked) => onChange(checked ? preset : undefined)} />
        <label htmlFor={id} className="flex-1 text-[13px] font-medium">{label}</label>
        <span className="font-mono text-xs text-muted-foreground">{ratioText(value)}</span>
      </div>
      {on ? (
        <Slider aria-label={label} min={0} max={1} step={0.01} value={[value]} disabled={disabled} onValueChange={([v]) => onChange(v)} />
      ) : null}
    </div>
  );
}
