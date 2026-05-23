"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/utils/utils";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { getPlayer } from "@/lib/music/tone-player";
import { useTranslator } from "@/lib/i18n";
import { NAV_ITEMS } from "./nav-items";

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const { resetFlow } = useMurmurStore();

  const handleHumClick = (e: React.MouseEvent) => {
    e.preventDefault();
    getPlayer().stop().catch(() => {});
    resetFlow();
    router.push("/");
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[#FFFDF8]/95 backdrop-blur-md border-t border-[#E8E2D9]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-end justify-around h-[64px] px-4">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          const label = t(item.labelKey);

          if (item.primary) {
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={label}
                className={cn(
                  "flex flex-col items-center justify-center w-16 h-16 -mt-7 rounded-full text-white shadow-lg transition-all",
                  isActive ? "bg-[#d4855a] scale-105" : "bg-[#E9A06D] hover:scale-105"
                )}
                style={{ boxShadow: "0 6px 20px rgba(233,160,109,0.4)" }}
              >
                <Icon className="w-7 h-7" strokeWidth={2.4} />
              </Link>
            );
          }

          const sharedClass = cn(
            "flex flex-col items-center justify-center flex-1 h-full transition-colors",
            isActive ? "text-[#E9A06D]" : "text-[#8B8680] hover:text-[#22303A]"
          );

          if (item.href === "/") {
            return (
              <button
                key={item.href}
                onClick={handleHumClick}
                aria-label={label}
                className={sharedClass}
              >
                <Icon
                  className={cn("w-6 h-6 mb-1 transition-transform", isActive && "scale-110")}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className="text-[11px] font-medium">{label}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={label}
              className={sharedClass}
            >
              <Icon
                className={cn("w-6 h-6 mb-1 transition-transform", isActive && "scale-110")}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span className="text-[11px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
