import { cn } from "@/lib/utils";

export type BadgeTone = "outline" | "secondary" | "brand" | "positive" | "negative" | "warning";

const TONES: Record<BadgeTone, string> = {
  outline: "border-border text-muted-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  brand: "border-transparent bg-brand-soft text-brand",
  positive: "border-transparent bg-positive-soft text-positive",
  negative: "border-transparent bg-negative-soft text-negative",
  warning: "border-transparent bg-warning-soft text-warning",
};

/** A short label for status, provenance or classification. The word carries the meaning. */
export function Badge({ tone = "outline", mono, dot, className, children, title }: {
  tone?: BadgeTone; mono?: boolean; dot?: boolean; className?: string; children: React.ReactNode; title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap",
        mono && "font-mono",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
