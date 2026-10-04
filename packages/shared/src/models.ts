import type { AreaGeometry } from "./geo";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export type AreaChangeType = "created" | "updated" | "deleted";

export interface Area {
  id: string;
  name: string;
  geometry: AreaGeometry;
  sizeKm2: number;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AreaHistoryEntry {
  id: string;
  name: string;
  areaId: string;
  geometry: AreaGeometry;
  sizeKm2: number;
  version: number;
  editedBy: string;
  editorName: string;
  editedAt: string;
  changeType: AreaChangeType;
}

export interface BoundingBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}
