import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useMapStore } from "../state/mapStore";
import { AreaSearchLoader, emptySearchState } from "./AreaSearchLoader";

export function useAreaSearch(query: string) {
  const [state, setState] = useState(emptySearchState);
  const loaderRef = useRef<AreaSearchLoader | null>(null);

  useEffect(() => {
    const loader = new AreaSearchLoader(api.searchAreas, setState);
    loaderRef.current = loader;
    void loader.reset(query);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Panning only changes the map's viewport data. Durable edits and reconnects
    // refresh the panel independently, including matches on unloaded pages.
    const unsubscribe = useMapStore.subscribe((next, previous) => {
      if (next.lastAreaChange !== previous.lastAreaChange ||
          (next.connectionStatus === "open" && previous.connectionStatus !== "open")) {
        clearTimeout(timer);
        timer = setTimeout(() => void loader.reset(query), 250);
      }
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      loader.dispose();
      loaderRef.current = null;
    };
  }, [query]);

  const loadMore = useCallback(() => { void loaderRef.current?.loadMore(); }, []);
  return { ...state, loadMore };
}
