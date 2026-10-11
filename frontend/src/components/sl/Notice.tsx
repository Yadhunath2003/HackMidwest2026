import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type NoticeTone = "info" | "warning" | "error";

const STYLES: Record<NoticeTone, { box: string; title: string; Icon: typeof Info }> = {
  info: { box: "bg-muted", title: "text-foreground", Icon: Info },
  warning: { box: "bg-warning-soft", title: "text-warning", Icon: TriangleAlert },
  error: { box: "bg-negative-soft", title: "text-negative", Icon: CircleAlert },
};

/** An inline message with an icon and a leading word. Errors announce themselves. */
export function Notice({ tone = "info", title, items, action, className, children }: {
  tone?: NoticeTone; title?: React.ReactNode | null; items?: string[]; action?: React.ReactNode;
  className?: string; children?: React.ReactNode;
}) {
  const { box, title: titleClass, Icon } = STYLES[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] leading-[18px]", box, className)}>
      <Icon aria-hidden className={cn("mt-px size-4 shrink-0", titleClass)} strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p>
          {title ? <strong className={cn("mr-1.5 font-semibold", titleClass)}>{title}</strong> : null}
          {children}
        </p>
        {items && items.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{items.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
