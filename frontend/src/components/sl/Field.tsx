import { useId } from "react";
import { cn } from "@/lib/utils";

const CONTROL = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-[invalid=true]:border-negative";

type Option = string | { value: string; label: string };

/** A labelled input or select. Units go in the label; numbers are set in mono; errors sit under the control. */
export function Field({ label, hint, error, as = "input", options, className, ...rest }: {
  label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; as?: "input" | "select";
  options?: Option[]; className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement> & React.SelectHTMLAttributes<HTMLSelectElement>, "className">) {
  const id = useId();
  const described = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
      {as === "select" ? (
        <select id={id} aria-invalid={error ? true : undefined} aria-describedby={described} className={CONTROL} {...(rest as React.SelectHTMLAttributes<HTMLSelectElement>)}>
          {options?.map((o) => {
            const opt = typeof o === "string" ? { value: o, label: o } : o;
            return <option key={opt.value} value={opt.value}>{opt.label}</option>;
          })}
        </select>
      ) : (
        <input id={id} aria-invalid={error ? true : undefined} aria-describedby={described}
          className={cn(CONTROL, rest.type === "number" && "font-mono")} {...(rest as React.InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {error ? <p id={`${id}-err`} className="text-xs text-negative">{error}</p> : hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
