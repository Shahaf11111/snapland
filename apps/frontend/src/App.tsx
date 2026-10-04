import { useAuthStore } from "./state/authStore.js";
import { AuthScreen } from "./components/AuthScreen.js";
import { MapView } from "./map/MapView.js";
import { UserMenu } from "./components/UserMenu.js";
import { useApplyTheme } from "./theme/useApplyTheme.js";
import { TooltipProvider } from "@/components/ui/tooltip";

export function App() {
  const user = useAuthStore((s) => s.user);
  useApplyTheme();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="fixed bottom-3 left-3 z-[1600]">
        <UserMenu />
      </div>
      {user ? <MapView /> : <AuthScreen />}
    </TooltipProvider>
  );
}
