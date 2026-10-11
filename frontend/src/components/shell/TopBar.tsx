"use client";

import { ChevronDown, ChevronRight, Moon, PanelLeft, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { shortId } from "@/lib/format";
import { applyTheme, readStoredTheme, type Theme } from "@/lib/use-theme";

export type Connection = "ok" | "ai-off" | "offline" | "checking";

const CONNECTION: Record<Connection, { label: string; dot: string }> = {
  ok: { label: "Connected", dot: "bg-positive" },
  "ai-off": { label: "AI not configured", dot: "bg-warning" },
  offline: { label: "Offline", dot: "bg-negative" },
  checking: { label: "Checking…", dot: "bg-muted-foreground" },
};

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const stored = readStoredTheme();
    if (stored) { setTheme(stored); applyTheme(stored); }
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <Button variant="ghost" size="icon-lg" aria-label={`Switch to ${next} theme`} onClick={() => { setTheme(next); applyTheme(next); }}>
      {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}

/** Breadcrumb, connection state (from /api/health only) and the run menu. */
export function TopBar({ section, title, badges, connection, runId, onSave, onDelete, onToggleSidebar }: {
  section: string; title?: string; badges?: React.ReactNode; connection: Connection; runId?: string | null;
  onSave?: () => void; onDelete?: () => void; onToggleSidebar: () => void;
}) {
  const c = CONNECTION[connection];
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b bg-background px-3">
      <Button variant="ghost" size="icon-lg" aria-label="Toggle sidebar" onClick={onToggleSidebar}><PanelLeft aria-hidden /></Button>
      <span aria-hidden className="h-5 w-px bg-border" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="hidden whitespace-nowrap text-muted-foreground sm:inline">{section}</span>
        {title ? (
          <>
            <ChevronRight aria-hidden className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
            <span className="truncate font-semibold">{title}</span>
          </>
        ) : null}
        {badges}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <span role="status" className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <span aria-hidden className={`size-1.5 rounded-full ${c.dot}`} />{c.label}
        </span>
        <ThemeToggle />
        {runId ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-full border border-input px-3 font-mono text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" title={runId}>
              run {shortId(runId)}<ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel className="font-mono text-xs">run {runId}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onSave?.()}>Save strategy…</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete?.()}>Delete result…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}
