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
 * Desktop sidebar — 240px column on md+. Quiet, plenty of breathing room,
 * mymind-style sign-off block at the bottom.
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
      className="hidden md:flex fixed top-0 left-0 bottom-0 w-[240px] z-40 flex-col bg-[#FFFEFB] border-r border-[#ECE5D6] px-7 py-9"
      style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 36px)" }}
    >
      <Link
        href="/"
        onClick={goHome}
        className="mb-14 inline-flex items-center transition-opacity hover:opacity-70"
      >
        <MurmurMark size={30} />
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          const label = t(item.labelKey);
          const baseClass = cn(
            "group flex items-center gap-3.5 px-3 py-2.5 rounded-md text-[14px] transition-all duration-200",
            isActive
              ? "text-[#1A1A1A]"
              : "text-[#8C8780] hover:text-[#1A1A1A]"
          );

          const content = (
            <>
              <Icon
                className={cn(
                  "w-[18px] h-[18px] transition-colors",
                  isActive ? "text-[#FF5924]" : "text-[#B6B0A4] group-hover:text-[#1A1A1A]"
                )}
                strokeWidth={isActive ? 2 : 1.7}
              />
              <span className="tracking-[0.005em]">{label}</span>
              {isActive ? (
                <span className="ml-auto w-1 h-1 rounded-full bg-[#FF5924]" />
              ) : null}
            </>
          );

          return item.href === "/" ? (
            <button
              key={item.href}
              onClick={goHome}
              className={cn(baseClass, "text-left w-full")}
            >
              {content}
            </button>
          ) : (
            <Link key={item.href} href={item.href} className={baseClass}>
              {content}
            </Link>
          );
        })}
      </nav>

      {/* Sign-off block — mymind feel: italic serif epigram + tiny meta */}
      <div className="mt-auto pt-10 border-t border-[#ECE5D6]">
        <p className="font-serif-italic text-[#1A1A1A] text-[17px] leading-[1.25]">
          A hum of yours,
          <br />
          becomes a song.
        </p>
        <p className="mt-3 text-[10px] text-[#B6B0A4] tracking-[0.18em] uppercase">
          murmur — 2026
        </p>
      </div>
    </aside>
  );
}
