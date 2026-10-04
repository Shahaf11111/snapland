/** Finite client-reported analytics vocabulary; never accept arbitrary payloads. */
export const UI_AUDIT_ACTIONS = [
  "ui.theme.change", "ui.menu.toggle", "ui.map.layer", "ui.map.zoom", "ui.map.move",
  "ui.areas.panel", "ui.areas.dock", "ui.area.focus", "ui.area.edit", "ui.area.history",
  "ui.history.shape", "ui.drawing.start", "ui.drawing.finish", "ui.drawing.cancel",
  "ui.draft.discard", "ui.conflict.reload", "ui.delete.dialog",
] as const;
export const UI_AUDIT_VALUES = ["light", "dark", "auto", "street", "satellite", "open", "closed", "left", "right", "in", "out"] as const;
export interface UiAuditEvent {
  action: typeof UI_AUDIT_ACTIONS[number];
  value?: typeof UI_AUDIT_VALUES[number];
  areaId?: string;
  version?: number;
}
