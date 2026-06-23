import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MeloLabClient from "./MeloLabClient";
import { meloLabGate } from "@/lib/test/melo-lab";

export const metadata: Metadata = {
  title: "MeLo Lab | Murmur",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function MeloLabPage() {
  if (!meloLabGate().ok) {
    notFound();
  }
  return <MeloLabClient />;
}
