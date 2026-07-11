import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Poke Deal",
    short_name: "Poke Deal",
    description: "GBP-native command centre for Pokémon card dealing.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#080b13",
    theme_color: "#080b13",
    orientation: "portrait",
    icons: [
      {
        src: "/brand/v2/app-icon-192-v1.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/v2/app-icon-512-v1.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/v2/app-icon-maskable-512-v1.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
