import { type Lang } from "@/lib/i18n/dict";
import { renderTranslationToken } from "@/lib/i18n/translate";
import type { NotificationCopyInput } from "@/lib/notifications/types";

export type { NotificationMeta } from "@/lib/notifications/types";

function token(key: string, lang: Lang): string {
  return renderTranslationToken(key, lang, "product");
}

export function formatNotificationTemplate(
  template: string,
  params: Record<string, string | number>,
): string {
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export function langFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
): Lang {
  return acceptLanguage?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function resolveNotificationCopy(
  item: NotificationCopyInput,
  lang: Lang,
): { title: string; body: string } {
  switch (item.kind) {
    case "song_generated":
      return resolveSongGeneratedCopy(item, lang);
    case "song_saved":
      return resolveSongSavedCopy(item, lang);
    case "system":
      return resolveSystemCopy(item, lang);
    default:
      return { title: item.title, body: item.body };
  }
}

function resolveSongGeneratedCopy(
  item: NotificationCopyInput,
  lang: Lang,
): { title: string; body: string } {
  const title = token("nav.notify.song_generated.title", lang) || item.title;
  const ready = item.meta?.readyCount;
  const total = item.meta?.totalCount;

  if (ready != null && total != null) {
    if (total === 1) {
      return {
        title,
        body:
          token("nav.notify.song_generated.body_single", lang) || item.body,
      };
    }
    if (ready === total) {
      return {
        title,
        body: token("nav.notify.song_generated.body_all", lang) || item.body,
      };
    }
    const partial = token("nav.notify.song_generated.body_partial", lang);
    if (partial) {
      return {
        title,
        body: formatNotificationTemplate(partial, {
          readyCount: ready,
          totalCount: total,
        }),
      };
    }
  }

  return {
    title,
    body: token("nav.notify.song_generated.body_all", lang) || item.body,
  };
}

function resolveSongSavedCopy(
  item: NotificationCopyInput,
  lang: Lang,
): { title: string; body: string } {
  const title = token("nav.notify.song_saved.title", lang) || item.title;
  const songTitle = item.meta?.songTitle?.trim();
  if (songTitle) {
    const named = token("nav.notify.song_saved.body_named", lang);
    if (named) {
      return {
        title,
        body: formatNotificationTemplate(named, { title: songTitle }),
      };
    }
  }
  return {
    title,
    body: token("nav.notify.song_saved.body", lang) || item.body,
  };
}

function resolveSystemCopy(
  item: NotificationCopyInput,
  lang: Lang,
): { title: string; body: string } {
  if (item.meta?.pushTestName) {
    const titleTemplate = token("nav.notify.push_test.title", lang);
    return {
      title: titleTemplate
        ? formatNotificationTemplate(titleTemplate, {
            name: item.meta.pushTestName,
          })
        : item.title,
      body: token("nav.notify.push_test.body", lang) || item.body,
    };
  }

  const isLocalTest =
    item.meta?.testVariant != null
    || item.sourceId?.startsWith("system:test:");

  if (isLocalTest) {
    const blocked = item.meta?.testVariant === "blocked";
    return {
      title: token("nav.notify.test.title", lang) || item.title,
      body: blocked
        ? token("nav.notify.test.blocked", lang) || item.body
        : token("nav.notify.test.body", lang) || item.body,
    };
  }

  return { title: item.title, body: item.body };
}

export function songGeneratedNotificationCopy(
  lang: Lang,
  input: { readyCount: number; totalCount: number },
): { title: string; body: string } {
  return resolveSongGeneratedCopy(
    {
      kind: "song_generated",
      title: "",
      body: "",
      meta: input,
    },
    lang,
  );
}

export function songSavedNotificationCopy(
  lang: Lang,
  songTitle: string,
): { title: string; body: string } {
  return resolveSongSavedCopy(
    {
      kind: "song_saved",
      title: "",
      body: "",
      meta: { songTitle },
    },
    lang,
  );
}

export function pushTestNotificationCopy(
  lang: Lang,
  name: string,
): { title: string; body: string } {
  return resolveSystemCopy(
    {
      kind: "system",
      title: "",
      body: "",
      meta: { pushTestName: name },
    },
    lang,
  );
}

export function dailyDigestNotificationCopy(
  lang: Lang,
): { title: string; body: string } {
  return {
    title:
      token("nav.notify.daily_digest.title", lang)
      || "Feel like humming today?",
    body:
      token("nav.notify.daily_digest.body", lang)
      || "Your saved songs are waiting — or start with a fresh hum.",
  };
}

