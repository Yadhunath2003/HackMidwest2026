import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { signed } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface MetricDelta {
  value: number; unit?: string; context: string; goodWhen?: "up" | "down"; digits?: number;
}

/** One big-number card. A delta only for a real computed comparison; otherwise a factual context line. */
export function MetricCard({ value, unit, prefix, label, delta, context, size = "md" }: {
  value: string; unit?: string; prefix?: string; label: string; delta?: MetricDelta | null; context?: string; size?: "md" | "sm";
}) {
  const small = size === "sm";
  return (
    <div className={cn("rounded-2xl border bg-card shadow-sm", small ? "p-3.5" : "p-5")}>
      <p className="flex min-w-0 items-baseline gap-1 tabular-nums">
        {prefix ? <span className={cn("font-medium text-muted-foreground", small ? "text-sm" : "text-lg")}>{prefix}</span> : null}
        <span className={cn("font-bold tracking-tight", small ? "text-xl" : "text-[44px] leading-[48px]")}>{value}</span>
        {unit ? <span className={cn("font-medium text-muted-foreground", small ? "text-sm" : "text-[22px]")}>{unit}</span> : null}
      </p>
      <p className={cn("text-muted-foreground", small ? "mt-0.5 text-[13px]" : "mt-1 text-sm")}>{label}</p>
      {delta ? <DeltaRow delta={delta} /> : context ? <p className={cn("text-muted-foreground", small ? "mt-1 text-xs" : "mt-5 text-sm")}>{context}</p> : null}
    </div>
  );
}

function DeltaRow({ delta }: { delta: MetricDelta }) {
  const { value, unit = "", context, goodWhen = "up", digits = 2 } = delta;
  const flat = Math.abs(value) < 10 ** -digits / 2;
  const good = flat ? null : goodWhen === "up" ? value > 0 : value < 0;
  const Arrow = flat ? ArrowRight : value > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = good == null ? "bg-muted text-muted-foreground" : good ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative";
  return (
    <p className="mt-4 flex items-center gap-2.5 text-sm">
      <span aria-hidden className={cn("flex size-8 items-center justify-center rounded-full", tone)}><Arrow className="size-4" strokeWidth={1.75} /></span>
      <span>
        <strong className={cn("font-semibold", good == null ? "text-foreground" : good ? "text-positive" : "text-negative")}>
          {signed(value, digits)}{unit ? ` ${unit}` : ""}
        </strong>{" "}
        <span className="text-muted-foreground">{context}</span>
      </span>
    </p>
  );
}
