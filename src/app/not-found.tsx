import type { Metadata } from "next";
import { NotFoundContent } from "@/components/murmur/not-found-content";

export const metadata: Metadata = {
  title: "Not Found",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return <NotFoundContent />;
}
