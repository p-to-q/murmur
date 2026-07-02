"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { request } from "@/lib/api/request";
import {
  sendBrowserNotification,
  useBrowserNotification,
} from "@/lib/hooks/use-browser-notification";
import { useTranslator } from "@/lib/i18n";
import { useNotificationStore } from "@/lib/store/notification-store";

export function useNotificationActions() {
  const t = useTranslator();
  const {
    permission,
    browserAlertsEnabled,
    setBrowserAlertsEnabled,
  } = useBrowserNotification();
  const addNotification = useNotificationStore((state) => state.addNotification);
  const [isTesting, setIsTesting] = useState(false);

  const alertsOn = permission === "granted" && browserAlertsEnabled;

  const sendTestNotification = useCallback(async () => {
    if (isTesting) return;

    setIsTesting(true);
    const title = t("nav.notify.test.title") || "Test notification";
    const enabledBody =
      t("nav.notify.test.body") ||
      "Murmur notifications are working on this device.";
    const blockedBody =
      t("nav.notify.test.blocked") ||
      "Browser alerts are blocked, but in-app notifications are working.";
    const testId = `system:test:${Date.now()}`;

    try {
      const nextPermission = await setBrowserAlertsEnabled(true);
      const serverPush = await request("/api/notifications/test", {
        method: "POST",
        headers: { accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) return { delivered: 0 };
          return (await response.json().catch(() => ({ delivered: 0 }))) as {
            delivered?: number;
          };
        })
        .catch(() => ({ delivered: 0 }));

      const canShowBrowserAlert = nextPermission === "granted";
      const serverDelivered = (serverPush.delivered ?? 0) > 0;
      addNotification({
        kind: "system",
        id: testId,
        title,
        body: canShowBrowserAlert ? enabledBody : blockedBody,
        sourceId: testId,
      });

      if (canShowBrowserAlert) {
        if (!serverDelivered) {
          sendBrowserNotification(title, {
            body: enabledBody,
            tag: "murmur-notification-test",
            showWhileVisible: true,
          });
        }
        toast.success(t("nav.notify.test.sent") || "Test notification sent.");
      } else if (nextPermission === "unsupported") {
        toast(t("nav.notify.unsupported") || "System alerts are not supported here.");
      } else {
        toast.error(t("nav.notify.denied") || "Notifications are blocked.");
      }
    } finally {
      setIsTesting(false);
    }
  }, [addNotification, isTesting, setBrowserAlertsEnabled, t]);

  return {
    permission,
    browserAlertsEnabled,
    alertsOn,
    isTesting,
    sendTestNotification,
    setBrowserAlertsEnabled,
  };
}
