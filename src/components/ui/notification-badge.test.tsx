import { afterEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  __testing,
  countUnreadNotifications,
  NotificationBadge,
} from "./notification-badge";
import { useNotificationStore } from "@/lib/store/notification-store";

function setUnreadCount(count: number) {
  useNotificationStore.setState({
    items: Array.from({ length: count }, (_, index) => ({
      id: `notification_${index}`,
      kind: "system" as const,
      title: `Notification ${index}`,
      body: "Body",
      createdAt: index,
    })),
  });
}

describe("NotificationBadge", () => {
  afterEach(() => {
    useNotificationStore.setState({ items: [] });
  });

  it("counts only unread notifications", () => {
    useNotificationStore.setState({
      items: [
        {
          id: "unread",
          kind: "system",
          title: "Unread",
          body: "Body",
          createdAt: 1,
        },
        {
          id: "read",
          kind: "system",
          title: "Read",
          body: "Body",
          createdAt: 2,
          readAt: 3,
        },
      ],
    });

    expect(countUnreadNotifications(useNotificationStore.getState().items)).toBe(1);
  });

  it("hides itself when there are no unread notifications", () => {
    setUnreadCount(0);

    expect(renderToStaticMarkup(<NotificationBadge />)).toBe("");
  });

  it("renders the unread count and accessible label", () => {
    setUnreadCount(7);

    const html = renderToStaticMarkup(
      <__testing.NotificationBadgeView count={7} className="ml-1" />,
    );

    expect(html).toContain("ml-1");
    expect(html).toContain('aria-label="7 unread"');
    expect(html).toContain(">7</span>");
  });

  it("caps the visible count at 99+ while preserving the exact label", () => {
    setUnreadCount(125);

    const html = renderToStaticMarkup(
      <__testing.NotificationBadgeView count={125} />,
    );

    expect(html).toContain('aria-label="125 unread"');
    expect(html).toContain(">99+</span>");
  });
});
