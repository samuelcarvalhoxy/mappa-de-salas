import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mappa de Salas",
    short_name: "Mappa",
    description: "O mapa vivo para encontrar e reservar salas.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8f4",
    theme_color: "#34785a",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
