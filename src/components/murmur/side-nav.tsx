"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/utils/utils";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { getPlayer } from "@/lib/music/tone-player";
import { useTranslator } from "@/lib/i18n";
import { MurmurMark } from "./murmur-mark";
import { NAV_ITEMS } from "./nav-items";

/**
 * Desktop sidebar — 240px wide column on md+. Mirrors the mobile bottom nav
 * but stacks vertically. Generous vertical rhythm to feel mymind-airy.
 */
export function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const { resetFlow } = useMurmurStore();

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault();
    getPlayer().stop().catch(() => {});
    resetFlow();
    router.push("/");
  };

  return (
    <aside
      className="hidden md:flex fixed top-0 left-0 bottom-0 w-[240px] z-40 flex-col bg-[#FFFDF8] border-r border-[#E8E2D9] px-6 py-8"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 30px)",
      }}
    >
      <Link
        href="/"
        onClick={goHome}
        className="mb-12 flex items-center transition-opacity hover:opacity-80"
      >
        <MurmurMark size={32} />
      </Link>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          const label = t(item.labelKey);
          const baseClass = cn(
            "group flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-[14px] transition-all duration-200",
            isActive
              ? "bg-[#FFEEDD] text-[#22303A] font-medium"
              : "text-[#8B8680] hover:bg-[#F7F3EA] hover:text-[#22303A] font-normal"
          );

          return item.href === "/" ? (
            <button key={item.href} onClick={goHome} className={cn(baseClass, "text-left w-full")}>
              <Icon
                className={cn(
                  "w-[18px] h-[18px] transition-transform group-hover:scale-110",
                  isActive ? "text-[#E9A06D]" : ""
                )}
                strokeWidth={isActive ? 2.2 : 1.9}
              />
              <span className="tracking-[0.01em]">{label}</span>
            </button>
          ) : (
            <Link key={item.href} href={item.href} className={baseClass}>
              <Icon
                className={cn(
                  "w-[18px] h-[18px] transition-transform group-hover:scale-110",
                  isActive ? "text-[#E9A06D]" : ""
                )}
                strokeWidth={isActive ? 2.2 : 1.9}
              />
              <span className="tracking-[0.01em]">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-8 border-t border-[#F0EAE0]">
        <p
          className="font-serif italic text-[#22303A] text-[15px] leading-snug"
          style={{ fontWeight: 500 }}
        >
          A hum of yours,
          <br />
          becomes a song.
        </p>
        <p className="mt-2.5 text-[11px] text-[#B8B0A2] tracking-[0.04em]">
          murmur · 2026
        </p>
      </div>
    </aside>
  );
}
