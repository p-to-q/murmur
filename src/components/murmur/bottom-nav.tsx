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
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[#FFFEFB]/95 backdrop-blur-md border-t border-[#ECE5D6]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-end justify-around h-[64px] px-4">
        {NAV_ITEMS.filter((item) => item.mobileNav !== false).map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          const label = t(item.labelKey);

          const sharedClass = cn(
            "flex flex-col items-center justify-center flex-1 h-full transition-colors",
            isActive ? "text-[#1A1A1A]" : "text-[#8C8780] hover:text-[#1A1A1A]"
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
                  className={cn(
                    "w-6 h-6 mb-1 transition-colors",
                    isActive ? "text-[#FF5924]" : ""
                  )}
                  strokeWidth={isActive ? 2.2 : 1.8}
                />
                <span className="text-[11px] tracking-[0.04em]">{label}</span>
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
                className={cn(
                  "w-6 h-6 mb-1 transition-colors",
                  isActive ? "text-[#FF5924]" : ""
                )}
                strokeWidth={isActive ? 2.2 : 1.8}
              />
              <span className="text-[11px] tracking-[0.04em]">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
