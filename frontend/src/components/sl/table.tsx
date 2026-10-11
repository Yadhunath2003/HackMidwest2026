import { cn } from "@/lib/utils";

/** Shared look for the data tables: hairline border, mono right-aligned numbers, scrolls inside its own wrapper. */
export function TableWrap({ children, className, maxHeight }: { children: React.ReactNode; className?: string; maxHeight?: number }) {
  return (
    <div className={cn("overflow-auto rounded-xl border", className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export const TH = "sticky top-0 whitespace-nowrap border-b bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground";
export const TD = "whitespace-nowrap border-b px-3 py-2 align-top";
export const NUM = "text-right font-mono tabular-nums";
