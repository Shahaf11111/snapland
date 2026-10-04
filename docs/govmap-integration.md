# Govmap imagery integration status

**Conclusion: not achievable as a Leaflet base layer, by design of Govmap's own
service — not a credential we simply don't have yet.** The application uses
Esri World Imagery as the satellite layer. This page documents a full
investigation (2026-10-04) of the official Govmap service, concluding that no
path from that service to a Leaflet-pluggable tile layer exists for a third
party, with or without a developer token. See **Final verdict** below before
spending more time on this.

## Investigation

### Reachability

Different Govmap hosts respond very differently from this environment, which
turned out to be informative rather than just inconsistent:

| Host | Result | Reading |
|---|---|---|
| `www.govmap.gov.il` | HTTP 403 (CloudFront) | The consumer-facing app's edge blocks this environment's requests (bot/automation detection on the main site is a common pattern; not conclusive on its own). |
| `cdn.govmap.gov.il` | HTTP 403 on every path tried, including root | Same signature as above. |
| `api.govmap.gov.il` | HTTP 200 — real site, reachable | Govmap's official developer documentation (Docusaurus). Fully explored — see below. |
| `open.govmap.gov.il/geoserver` | HTTP 200 — real, public WMS | See "Public WMS" below. |
| `tiles.govmap.gov.il` | **HTTP 401**, `WWW-Authenticate: Basic realm="provide a user and password"`, via a CloudFront Lambda authorizer | A real, dedicated tile host exists. It is gated by HTTP Basic Auth at the edge, uniformly across every path tried — not a bot/WAF block, a deliberate credential requirement. |

The 401 (not 403) on `tiles.govmap.gov.il` is the key data point: it means
this environment *can* reach that host, and the host explicitly wants a
username/password, not just a different client fingerprint. There is no
public or anonymous path through it.

### Govmap's public developer API (`api.govmap.gov.il`) — fully enumerated

Pulled the site's `sitemap.xml` and read the relevant pages directly (not
summarized from search). It documents three integration modes: **URL**
(deep-link into Govmap's own portal), **HTML** (iframe embed), and
**JavaScript functions** (SDK). All ~70 documented functions
(`createMap`, `setBackground`, `draw`, `getLayerEntities`, `geocode`, etc.)
operate on Govmap's own embedded map widget. **No XYZ/WMTS/WMS tile endpoint
is documented anywhere in this API.**

- [`create-map`](https://api.govmap.gov.il/docs/javascript-functions/create-map)
  shows the real integration pattern:
  ```html
  <script src="https://www.govmap.gov.il/govmap/api/govmap.api.js" defer onload="initGovMap()"></script>
  <script>
  function initGovMap() {
    govmap.createMap('map', { token: 'YOUR_API_TOKEN', background: "1", /* ... */ });
  }
  </script>
  ```
  This renders Govmap's **own complete map control** into a `<div>`. It is not
  a tile source — nothing here is pluggable into `L.tileLayer()`.
- [`set-background`](https://api.govmap.gov.il/docs/javascript-functions/set-background)
  confirms `background: "1"` is literally "תצלום אוויר" (Aerial Photography) —
  the layer this assignment and the referenced URL (`...&b=1&...`) both want.
  Other IDs: `0`/`15` streets, `2` hybrid, `3` CIR, `9` topographic, `5-8`/`33-43`
  historical imagery. The docs do not disclose any backend tile infrastructure.
- [`get-map-url`](https://api.govmap.gov.il/docs/javascript-functions/get-map-url)
  returns a link back into Govmap's own portal, e.g.
  `https://www.govmap.gov.il/?z=6&c=184710.39,665906.35&lay=141&b=3` — **not** a
  tile template. Its coordinates (`184710.39, 665906.35`) are Israel Transverse
  Mercator eastings/northings, not WGS84 lat/lng degrees: this is primary-source
  confirmation that Govmap's internal map state is ITM (**EPSG:2039**), not Web
  Mercator — upgrading what was previously only a third-party, unverified claim.
- **Token registration**: `token: 'YOUR_API_TOKEN'` is documented as "מפתח
  אימות ל-API" (an API authentication key), domain-bound — confirmed by
  primary source, the docs' own usage terms: "Only a registered user may use
  the JavaScript functions. A registered user is one who received a Token,
  entered when creating the map. The issued Token is tied to the domain the
  page sits on and is not valid on another domain. If the hosting domain
  isn't authorized (wrong domain, wrong user code, permission never granted
  or revoked by Mapi) — an error is shown and the map ignores the function
  call." This settles that the token mechanism is domain-locked SDK
  authorization, not a credential that could front a tile request from
  anywhere else (e.g. a backend proxy) — it's checked against the referring
  page's domain, same mechanism as a browser CORS/referer check, and has
  nothing to do with the separate Basic Auth on `tiles.govmap.gov.il`. **No
  self-service registration page, form, or process is documented anywhere on
  the docs site.** The only concrete contact found is `govmap@mapi.gov.il`
  (from the WMS service metadata below).

### Public WMS (`open.govmap.gov.il/geoserver/opendata`)

Real, public, unauthenticated (`Fees: NONE`, `AccessConstraints: NONE`,
contact `govmap@mapi.gov.il`) — confirmed via a direct `GetCapabilities`
request. **Not** a source for aerial imagery: its layer list is
cadastral/administrative only (`PARCEL_ITM`, `muni_il`, `nechalim`, drainage
basins, etc.). Sibling workspace names tried (`ortho`, `aerial`, `imagery`,
`raster`) all 404.

## Final verdict

Two independent blockers, not one:

1. **No tile endpoint is offered to third parties at all**, with a token or
   without one. The entire public API is "embed our widget," not "fetch our
   tiles." Obtaining a `createMap` token (by emailing `govmap@mapi.gov.il` —
   the only lead found; no self-service path exists) would only unlock
   Govmap's own widget rendering into its own `<div>`, which cannot become a
   swappable base layer of this app's Leaflet map — drawn polygons live in the
   Leaflet map instance, and switching to a separate embedded widget would not
   carry them along. This fails the assignment's "switch between regular map
   and satellite views [of the same map]" and "ensure drawn elements remain
   properly positioned when switching layers" requirements by construction,
   independent of credentials.
2. **The one real tile host found (`tiles.govmap.gov.il`) is Basic-Auth-gated**
   and nothing in the public docs indicates how a third-party developer would
   obtain those specific credentials — they read as internal or GIS-partner
   infrastructure (the kind a desktop GIS client like QGIS/ArcGIS would be
   configured with), not the same token `createMap` uses.

Pursuing a `createMap` token is therefore not a productive next step: it does
not lead to a Leaflet-compatible imagery source even if granted. Getting
Basic Auth credentials for `tiles.govmap.gov.il` is possible in principle
(contact `govmap@mapi.gov.il` and ask specifically for raw tile/GIS access
rather than an SDK token) but is a human/organizational process outside this
repository's reach, with no guarantee it's offered to external developers at
all, and would still need the ITM→Web Mercator reprojection problem solved
(`Proj4Leaflet` or a server-side reprojecting tile proxy) before it could
become a Leaflet layer.

**Current state is the practical ceiling without that external access:** Esri
World Imagery as the satellite layer, with the `VITE_GOVMAP_TILE_URL` adapter
left in place as the integration seam — see below for exactly what it expects
if real credentials and a real tile endpoint are ever obtained.

## What a real integration would still need

If `tiles.govmap.gov.il` (or an equivalent) access is ever obtained:

- Confirm the actual tile protocol and grid behind the Basic Auth (XYZ/WMTS/
  WMS, and whether it's the suspected ITM pyramid or something else) — the
  credentials themselves don't reveal this, a service description would.
- A private Basic Auth credential must never go into a Vite environment
  variable — those are compiled into the browser bundle and visible to anyone.
  Tiles would need to be proxied through the backend (which attaches the
  credential server-side) rather than fetched directly from the browser.
- If the tiles are ITM-projected, either `Proj4Leaflet` (a real third-party
  dependency — for the basemap, not the "collaborative features" the
  assignment restricts third-party plugins for) or a server-side reprojection
  step is required before `L.tileLayer`/`L.tileLayer.wms` can render them.
- The existing `VITE_GOVMAP_TILE_URL` adapter in `baseLayers.ts` already
  supports a Leaflet-compatible EPSG:3857 XYZ template with `{z}`/`{x}`/`{y}`
  placeholders — that remains correct for *if* a Mercator-compatible endpoint
  (direct or proxied/reprojected) is ever available; it is not correct for
  raw ITM tiles or for a `createMap` SDK token, neither of which fit that shape.

## Acceptance checks

Once a supported endpoint and real credentials are available:

1. Verify imagery requests succeed and come from the documented Govmap service.
2. Check known landmarks and a saved polygon for alignment at several zoom levels.
3. Switch OSM → Govmap → OSM while drawing and editing; retain vertices and state.
4. Verify transitions do not leave the map blank and drawing overlays stay visible.
5. Exercise unavailable imagery and show the actual provider used on fallback.
6. Document the verified setup and distinguish live-provider checks from mocked tests.
