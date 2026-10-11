"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import type { SavedStrategy } from "@/lib/types";
import { DeleteRunDialog } from "./Dialogs";
import { SidebarContent, type RunRow } from "./Sidebar";
import { TopBar, type Connection } from "./TopBar";

interface ShellApi {
  runs: RunRow[];
  saved: SavedStrategy[];
  connection: Connection;
  /** Re-fetch the sidebar's runs and saved strategies. */
  reload: () => void;
  /** Open the delete confirmation for a run. */
  requestDeleteRun: (id: string) => void;
  /** The run that was last deleted (or found missing), so a screen showing it can clear it. */
  deleted: { id: string; n: number } | null;
}

const ShellContext = createContext<ShellApi>({ runs: [], saved: [], connection: "checking", reload: () => {}, requestDeleteRun: () => {}, deleted: null });
export const useShell = () => useContext(ShellContext);

/** Holds what the sidebar and top bar show (runs, saved strategies, health) and the delete confirmation. */
export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [saved, setSaved] = useState<SavedStrategy[]>([]);
  const [connection, setConnection] = useState<Connection>("checking");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ id: string; n: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    api.recentRuns().then(setRuns).catch(() => setRuns([]));
    api.savedStrategies().then(setSaved).catch(() => setSaved([]));
  }, [reloadKey]);

  // Connection state comes from a real health check, and is re-checked while the page stays open.
  useEffect(() => {
    let stale = false;
    const check = () => api.health().then(
      (h) => !stale && setConnection(h.ai_configured ? "ok" : "ai-off"),
      () => !stale && setConnection("offline"),
    );
    void check();
    const timer = setInterval(check, 30_000);
    return () => { stale = true; clearInterval(timer); };
  }, []);

  const value = useMemo<ShellApi>(() => ({ runs, saved, connection, reload, requestDeleteRun: setDeleting, deleted }), [runs, saved, connection, reload, deleted]);

  return (
    <ShellContext.Provider value={value}>
      {children}
      <DeleteRunDialog runId={deleting} onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={(id) => { reload(); setDeleted((d) => ({ id, n: (d?.n ?? 0) + 1 })); }} />
    </ShellContext.Provider>
  );
}

/** Sidebar | top bar over the screen. Under 1200px the sidebar moves into a Sheet. */
export function AppShell({ screen, section, title, badges, runId, onSaveRun, onSelectRun, onNew, children }: {
  screen: "backtest" | "paper"; section: string; title?: string; badges?: React.ReactNode; runId?: string | null;
  onSaveRun?: () => void; onSelectRun?: (id: string) => void; onNew?: () => void; children: React.ReactNode;
}) {
  const router = useRouter();
  const { runs, saved, connection, requestDeleteRun } = useShell();
  const [collapsed, setCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleSelectRun = (id: string) => (onSelectRun ? onSelectRun(id) : router.push(`/?run=${encodeURIComponent(id)}`));
  const handleNew = () => (onNew ? onNew() : router.push("/"));
  const sidebar = (inSheet: boolean) => (
    <SidebarContent screen={screen} runs={runs} saved={saved} activeRunId={runId}
      onSelectRun={handleSelectRun} onDeleteRun={requestDeleteRun} onNew={handleNew} onNavigate={inSheet ? () => setSheetOpen(false) : undefined} />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {!collapsed ? <aside className="hidden w-[248px] shrink-0 border-r min-[1200px]:block">{sidebar(false)}</aside> : null}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="w-[280px] gap-0 p-0 min-[1200px]:hidden" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Screens, saved strategies and runs</SheetDescription>
          {sidebar(true)}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar section={section} title={title} badges={badges} connection={connection} runId={runId}
          onSave={onSaveRun} onDelete={() => runId && requestDeleteRun(runId)}
          onToggleSidebar={() => (window.matchMedia("(min-width: 1200px)").matches ? setCollapsed((c) => !c) : setSheetOpen(true))} />
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
