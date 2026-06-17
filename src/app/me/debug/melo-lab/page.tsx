import type { Metadata } from "next";
import { Suspense } from "react";
import MeloLabClient from "./MeloLabClient";

export const metadata: Metadata = {
  title: "Melo Lab",
};

export default function MeloLabPage() {
  return (
    <Suspense fallback={<MeloLabShell /> }>
      <MeloLabClient />
    </Suspense>
  );
}

function MeloLabShell() {
  return (
    <div className="min-h-svh bg-[#F5F1EB] p-8 text-[#1A1A1A]">
      <p className="text-[10px] uppercase tracking-[0.24em] text-[#FF5924]">
        TEST ONLY / local melo-lab
      </p>
      <h1 className="mt-2 hero-serif text-[42px]">Melo Lab</h1>
      <p className="mt-2 text-[13px] text-[#6F6A63]">Loading melo-lab...</p>
    </div>
  );
}
