import type { MetadataRoute } from "next";
import { SITE_CONFIG } from "@/lib/constants";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_CONFIG.name,
    short_name: "MURMUR",
    description: SITE_CONFIG.description,
    start_url: "/",
    display: "standalone",
    background_color: "#F5F1EB",
    theme_color: "#F5F1EB",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/brand/murmur-app-icon-120-rounded.png",
        sizes: "120x120",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/murmur-app-icon-180-rounded.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/murmur-app-icon-256-rounded.png",
        sizes: "256x256",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/murmur-app-icon-512-rounded.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/murmur-app-icon-512-rounded.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/murmur-app-icon-1024-rounded.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brand/murmur-app-icon-1024-rounded.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    categories: ["music", "entertainment", "lifestyle"],
    lang: "zh-CN",
    dir: "auto",
    screenshots: [],
  };
}
