export class NotificationPublishError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = "NotificationPublishError";
  }
}

export interface NotificationPublishInput {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export const notifications = {
  async publish(input: NotificationPublishInput) {
    return {
      delivered: 0,
      publishId: `local-${Date.now()}`,
      title: input.title,
      skipped: true,
      reason:
        "Standalone Murmur has no push gateway configured yet. Native push can be wired through the platform adapter.",
    };
  },
};
