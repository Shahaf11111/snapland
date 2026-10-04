import type { UiAuditEvent } from "@snapland/shared";
import { useAuthStore } from "../state/authStore.js";
import { api } from "./client.js";

/** Best-effort authenticated analytics; never block interaction or queue offline. */
export function auditUiAction(action: UiAuditEvent["action"], details: Omit<UiAuditEvent, "action"> = {}): void {
  if (!useAuthStore.getState().accessToken) return;
  void api.recordUiAction({ action, ...details }).catch(() => {
    console.warn("UI audit event could not be delivered");
  });
}
