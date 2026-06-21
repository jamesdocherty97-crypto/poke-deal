import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pokemon Dealer OS",
    short_name: "Dealer OS",
    description: "GBP-native command centre for Pokemon card dealing.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#101114",
    theme_color: "#101114",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
