import type { PresenceUser } from "@snapland/shared";
import { useAuthStore } from "../state/authStore.js";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface PresenceBarProps {
  presence: PresenceUser[];
}

/** Shows who else is currently viewing the map — the current user's own
 *  presence entry is excluded, since they're already represented by the
 *  avatar in the user menu (bottom-left). */
export function PresenceBar({ presence }: PresenceBarProps) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const others = presence.filter((u) => u.userId !== currentUserId);

  if (others.length === 0) return null;

  return (
    <div className="flex items-center -space-x-2">
      {others.map((u) => (
        <Tooltip key={u.userId}>
          <TooltipTrigger asChild>
            <Avatar className="h-7 w-7 border-2 border-background">
              <AvatarFallback style={{ backgroundColor: u.color }} className="text-[11px] text-white">
                {u.name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>{u.name}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
