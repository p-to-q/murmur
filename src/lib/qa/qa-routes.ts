export interface QaRouteLink {
  href: string;
  label: string;
  note: string;
}

export interface QaRouteContract extends QaRouteLink {
  name: string;
  markers: string[];
}

export const QA_ROUTE_CONTRACTS: QaRouteContract[] = [
  {
    name: "hum-home",
    href: "/",
    label: "Hum",
    note: "Start of the mainline flow.",
    markers: ["示例旋律", "脑海里的旋律"],
  },
  {
    name: "gallery-page",
    href: "/gallery",
    label: "Gallery",
    note: "Saved-song shelf and empty-state contract.",
    markers: ["灵感集", "藏歌"],
  },
  {
    name: "me-page",
    href: "/me",
    label: "Me",
    note: "Profile, notes, and repair-bias surface.",
    markers: ["我"],
  },
  {
    name: "studio-empty-page",
    href: "/studio",
    label: "Studio empty",
    note: "Empty-state fallback when no version is selected.",
    markers: ["还没有选定版本", "去哼一段旋律"],
  },
  {
    name: "vibe-route-shell",
    href: "/vibe",
    label: "Vibe shell",
    note: "Route shell for the discover surface.",
    markers: ["风物"],
  },
  {
    name: "vibe-demo-route",
    href: "/vibe?demo=1",
    label: "Vibe demo",
    note: "Hydrated mid-flow demo state.",
    markers: ["demo-vibe-route"],
  },
  {
    name: "studio-demo-route",
    href: "/studio?demo=1",
    label: "Studio demo",
    note: "Arrangement and edit surface without a fresh hum.",
    markers: ["demo-studio-route"],
  },
  {
    name: "studio-name-demo-route",
    href: "/studio/name?demo=1",
    label: "Name demo",
    note: "Save-stage naming surface with deterministic demo state.",
    markers: ["demo-name-route"],
  },
  {
    name: "debug-qa-cockpit",
    href: "/me/debug?debug=1",
    label: "QA cockpit",
    note: "Hidden debug surface; the fetch smoke checks its SSR fallback before client diagnostics hydrate.",
    markers: ["Murmur / Debug", "Loading debug surface"],
  },
  {
    name: "settings-developer-mode",
    href: "/me/settings",
    label: "Settings",
    note: "Developer mode toggle and low-cost local diagnostics.",
    markers: ["设置", "开发者模式"],
  },
];

export const QA_ROUTE_LINKS: QaRouteLink[] = QA_ROUTE_CONTRACTS.map(
  ({ href, label, note }) => ({ href, label, note }),
);

export const QA_ROUTE_PATHS = QA_ROUTE_CONTRACTS.map(({ href }) => href);
