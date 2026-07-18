"use client";

import { useNotificationStore } from "@/lib/store/notification-store";
import type { MurmurNotification } from "@/lib/notifications/types";

export function countUnreadNotifications(items: MurmurNotification[]): number {
  return items.filter((item) => !item.readAt).length;
}

export function useUnreadNotificationCount(): number {
  return useNotificationStore((state) =>
    countUnreadNotifications(state.items),
  );
}

function NotificationBadgeView({
  count,
  className = "",
}: {
  count: number;
  className?: string;
}) {
  if (count === 0) return null;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-[#FF762F] text-white font-medium tabular-nums leading-none ${className}`}
      style={{
        minWidth: 18,
        height: 18,
        fontSize: 11,
        padding: "0 5px",
      }}
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function NotificationBadge({
  className = "",
}: {
  className?: string;
}) {
  const count = useUnreadNotificationCount();
  return <NotificationBadgeView count={count} className={className} />;
}

export const __testing = {
  NotificationBadgeView,
};
