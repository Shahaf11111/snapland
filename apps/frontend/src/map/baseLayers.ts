import L from "leaflet";

const MAX_ZOOM = 19;

export function createOsmLayer(): L.TileLayer {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: MAX_ZOOM,
    attribution: "&copy; OpenStreetMap contributors",
  });
}

/**
 * Optional configured XYZ imagery source; otherwise Esri World Imagery.
 * VITE_GOVMAP_TILE_URL must be a verified, permitted EPSG:3857 tile template.
 * Govmap's endpoint, access requirements and tile grid have not been verified;
 * accepting a URL here does not by itself implement the Govmap requirement.
 * See docs/govmap-integration.md for the outstanding provider verification.
 */
export function createSatelliteLayer(): L.TileLayer {
  const fallback = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

  const govmapUrl = import.meta.env.VITE_GOVMAP_TILE_URL as string | undefined;
  const url = govmapUrl || fallback;

  const layer = L.tileLayer(url, {
    maxZoom: MAX_ZOOM,
    attribution: govmapUrl ? "Imagery &copy; govmap.gov.il" : "Imagery &copy; Esri (govmap.gov.il fallback)",
  });

  let fellBack = !govmapUrl;
  layer.on("tileerror", () => {
    if (fellBack) return;
    fellBack = true;
    layer.setUrl(fallback);
  });

  return layer;
}
