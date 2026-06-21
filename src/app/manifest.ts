import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pokémon Dealer OS",
    short_name: "Dealer OS",
    description: "GBP-native command centre for Pokémon card dealing.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#080b13",
    theme_color: "#ef3340",
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
