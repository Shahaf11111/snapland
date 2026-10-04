import { auditUiAction } from "../api/auditUiAction.js";
import { useEffect, useState } from "react";
import type { Area, AreaHistoryEntry } from "@snapland/shared";
import { api } from "../api/client";
import { useMapStore } from "../state/mapStore";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export function AreaHistoryDialog({ area, onClose }: { area: Area; onClose: () => void }) {
  const [history, setHistory] = useState<AreaHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => useMapStore.subscribe((next, previous) => {
    if (next.lastAreaChange !== previous.lastAreaChange && next.lastAreaChange?.id === area.id) {
      setRevision((value) => value + 1);
    }
  }), [area.id]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.getAreaHistory(area.id, controller.signal)
      .then(({ history }) => {
        if (!controller.signal.aborted) setHistory([...history].sort((a, b) => b.version - a.version));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load history.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [area.id, revision]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Area history</DialogTitle>
          <DialogDescription className="break-words">Saved versions of {area.name}, newest first.</DialogDescription>
        </DialogHeader>
        {loading && <p role="status" className="text-sm text-muted-foreground">Loading history…</p>}
        {error && <div role="alert" className="text-sm text-destructive">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>Retry</Button>
        </div>}
        {!loading && !error && history.length === 0 && <p className="text-sm text-muted-foreground">No saved history yet.</p>}
        <ol className="space-y-3" aria-label="Saved versions">
          {history.map((entry) => (
            <li key={entry.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <strong>Version {entry.version}</strong>
                <span className="capitalize text-muted-foreground">{entry.changeType}</span>
              </div>
              <p className="mt-1 break-words text-sm font-medium">{entry.name}</p>
              <p className="text-xs text-muted-foreground">
                {entry.editorName} · <time dateTime={entry.editedAt}>{new Date(entry.editedAt).toLocaleString()}</time>
              </p>
              <p className="mt-1 text-xs">{Number(entry.sizeKm2.toFixed(6))} km² · {entry.geometry.coordinates[0].length - 1} vertices</p>
              <details className="mt-2 text-xs" onToggle={(event) => { if (event.currentTarget.open) auditUiAction("ui.history.shape", { areaId: area.id, version: entry.version }); }}>
                <summary className="cursor-pointer text-muted-foreground">View saved shape</summary>
                <HistoryShape entry={entry} />
              </details>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

function HistoryShape({ entry }: { entry: AreaHistoryEntry }) {
  const ring = entry.geometry.coordinates[0];
  const latitude = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const points = ring.map(([lng, lat]) => [lng * Math.cos(latitude * Math.PI / 180), -lat]);
  const minX = Math.min(...points.map(([x]) => x)), minY = Math.min(...points.map(([, y]) => y));
  const width = Math.max(...points.map(([x]) => x)) - minX;
  const height = Math.max(...points.map(([, y]) => y)) - minY;
  const scale = Math.min(200 / (width || 1), 120 / (height || 1));
  const outline = points.map(([x, y]) => `${(x - minX) * scale + (240 - width * scale) / 2},${(y - minY) * scale + (160 - height * scale) / 2}`).join(" ");
  return (
    <svg role="img" aria-label={`Shape at version ${entry.version}`} viewBox="0 0 240 160" className="mt-2 h-40 w-full rounded bg-muted">
      <polygon points={outline} fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2" className="text-primary" />
    </svg>
  );
}
