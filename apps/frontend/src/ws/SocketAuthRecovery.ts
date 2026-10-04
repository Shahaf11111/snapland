import { refreshSession } from "../api/refreshSession.js";
import { useAuthStore } from "../state/authStore.js";

/** A refreshed credential rejected before readiness must not create a refresh loop. */
export class SocketAuthRecovery {
  private recoveredToken: string | null = null;

  ready(): void { this.recoveredToken = null; }

  async recover(rejectedToken: string): Promise<string> {
    if (this.recoveredToken === rejectedToken) {
      const session = useAuthStore.getState();
      if (session.accessToken === rejectedToken) session.clearSession();
      throw new Error("Refreshed socket authentication rejected");
    }
    const token = await refreshSession(rejectedToken);
    this.recoveredToken = token;
    return token;
  }
}
