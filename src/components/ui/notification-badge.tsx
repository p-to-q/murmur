"use client";

import { useNotificationStore } from "@/lib/store/notification-store";

export function useUnreadNotificationCount(): number {
  return useNotificationStore((state) =>
    state.items.filter((item) => !item.readAt).length,
  );
}

export function NotificationBadge({
  className = "",
}: {
  className?: string;
}) {
  const count = useUnreadNotificationCount();
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
