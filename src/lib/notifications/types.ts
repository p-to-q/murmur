export type MurmurNotificationKind =
  | "song_generated"
  | "song_saved"
  | "system";

export type NotificationMeta = {
  readyCount?: number;
  totalCount?: number;
  songTitle?: string;
  testVariant?: "enabled" | "blocked";
  pushTestName?: string;
};

export type MurmurNotification = {
  id: string;
  kind: MurmurNotificationKind;
  title: string;
  body: string;
  href?: string;
  createdAt: number;
  readAt?: number;
  sourceId?: string;
  meta?: NotificationMeta;
};

export type NotificationCopyInput = Pick<
  MurmurNotification,
  "kind" | "title" | "body" | "meta" | "sourceId"
>;
