"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/utils/utils";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { getPlayer } from "@/lib/music/tone-player";
import { useTranslator } from "@/lib/i18n";
import { NAV_ITEMS } from "./nav-items";

/**
 * Mobile bottom nav — 5 items, Create raised in the centre.
 * Layout: [Vibe][Studio]  ◉ CREATE ◉  [Gallery][Me]
 */
// Pages whose own bottom UI (e.g. Studio's save bar) conflicts with the raised
// Create button — hide bottom nav there to keep the focused workspace clean.
const HIDE_ON: string[] = ["/studio"];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const { resetFlow } = useMurmurStore();

  if (HIDE_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const handleCreate = (e: React.MouseEvent) => {
    e.preventDefault();
    getPlayer().stop().catch(() => {});
    resetFlow();
    router.push("/");
  };

  const items = NAV_ITEMS.filter((item) => item.mobileNav !== false);
  const createIdx = items.findIndex((it) => it.href === "/");
  const left = createIdx >= 0 ? items.slice(0, createIdx) : items.slice(0, 2);
  const right = createIdx >= 0 ? items.slice(createIdx + 1) : items.slice(2);
  const createItem = items[createIdx];

  const renderSmall = (item: (typeof items)[number]) => {
    const isActive =
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    const Icon = item.icon;
    const label = t(item.labelKey);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-label={label}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1 transition-colors",
          isActive ? "text-[#1A1A1A]" : "text-[#A29A8C] hover:text-[#1A1A1A]"
        )}
      >
        <Icon
          className={cn(
            "h-[22px] w-[22px] transition-colors",
            isActive ? "text-[#FF5924]" : ""
          )}
          active={isActive}
        />
        <span className="text-[10px] tracking-[0.04em] leading-none">
          {label}
        </span>
      </Link>
    );
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="relative bg-[#FFFEFB]/95 backdrop-blur-md border-t border-[#ECE5D6]">
        <div className="flex items-stretch justify-between h-[68px] px-2">
          {left.map(renderSmall)}
          <div className="w-[78px] shrink-0" aria-hidden="true" />
          {right.map(renderSmall)}
        </div>

        {createItem ? (
          <button
            onClick={handleCreate}
            aria-label={t(createItem.labelKey)}
            className="absolute left-1/2 -translate-x-1/2 -top-6 flex h-[60px] w-[60px] items-center justify-center rounded-full text-white shadow-[0_10px_28px_rgba(255,89,36,0.45)] transition-transform active:scale-95"
            style={{
              background:
                "radial-gradient(circle at 30% 28%, #FFB48A 0%, #FF8A5C 38%, #FF5924 100%)",
            }}
          >
            <createItem.icon
              className="h-[26px] w-[26px] text-white"
              active
            />
          </button>
        ) : null}
      </div>
    </nav>
  );
}
