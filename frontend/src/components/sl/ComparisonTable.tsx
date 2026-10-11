import { cn } from "@/lib/utils";
import { NUM, TableWrap, TD, TH } from "./table";

export interface ComparisonColumn { title: string; subtitle?: string }
export interface ComparisonRow { label: string; values: (string | { value: string; tone?: "positive" | "negative" })[] }

/** The Reliability report: the original run beside a higher-cost rerun and an earlier versus later period. */
export function ComparisonTable({ columns, rows }: { columns: ComparisonColumn[]; rows: ComparisonRow[] }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={TH}><span className="sr-only">Metric</span></th>
          {columns.map((c) => (
            <th key={c.title} className={cn(TH, "text-right align-bottom")}>
              <span className="block text-foreground">{c.title}</span>
              {c.subtitle ? <span className="block font-normal">{c.subtitle}</span> : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" className={cn(TD, "text-left font-normal text-muted-foreground")}>{row.label}</th>
            {row.values.map((v, i) => {
              const cell = typeof v === "string" ? { value: v } : v;
              return (
                <td key={i} className={cn(TD, NUM, cell.tone === "positive" && "text-positive", cell.tone === "negative" && "text-negative")}>{cell.value}</td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
