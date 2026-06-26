"use client";

import { MurmurMark } from "./murmur-mark";

export function MobileTopBar() {
  return (
    <header
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between md:hidden pointer-events-none"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <MurmurMark size={22} className="pointer-events-auto" />
    </header>
  );
}
