import { CandlestickChart } from "lucide-react";
import { cn } from "@/lib/utils";

/** The app mark: lucide's CandlestickChart on a primary square. There is no logo yet. */
export function Mark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground", className)}>
      <CandlestickChart className="size-3.5" strokeWidth={1.75} />
    </span>
  );
}

/** One turn: a user bubble on the right, an assistant reply panel on the left, or a centred event line. */
export function ChatMessage({ role, text, meta, children }: {
  role: "user" | "assistant" | "event"; text?: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode;
}) {
  if (role === "event") {
    return (
      <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator" aria-label={typeof text === "string" ? text : undefined}>
        <span className="h-px flex-1 bg-border" />{text}<span className="h-px flex-1 bg-border" />
      </div>
    );
  }
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl bg-secondary px-3.5 py-2.5 text-sm leading-[22.75px]">{text}</p>
      </div>
    );
  }
  return (
    <article className="space-y-3 rounded-2xl bg-reply p-4">
      <header className="flex items-center gap-2">
        <Mark />
        <span className="text-[13px] font-medium text-muted-foreground">StrategyLab</span>
        {meta ? <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">{meta}</span> : null}
      </header>
      {text ? <p className="font-serif text-base leading-[26px]">{text}</p> : null}
      {children}
    </article>
  );
}

/** The empty Backtest state: a display line, one sentence and 2-4 suggestions that fill the composer without sending. */
export function Welcome({ suggestions, onPick }: { suggestions: { title: string; description: string }[]; onPick: (s: { title: string; description: string }) => void }) {
  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold leading-8 tracking-[-0.02em]">What should we test today?</h1>
        <p className="text-sm text-muted-foreground">Describe a trading rule in plain words. I&apos;ll turn it into rules you can review, then backtest it on historical candles. Nothing runs until you press Run backtest.</p>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button key={s.title} type="button" onClick={() => onPick(s)}
            className="flex flex-col items-start justify-start gap-1 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:bg-accent">
            <span className="text-sm font-semibold">{s.title}</span>
            <span className="line-clamp-3 text-[13px] leading-[18px] text-muted-foreground">{s.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
