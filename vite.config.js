import { defineConfig, loadEnv } from "vite";

// GitHub Pages: https://juneaucross.github.io/super-deri/ (repo super-deri).
// Project site: set base to "/super-deri/" if you switch away from relative assets.
// Note: GitHub Pages does not let you set Cache-Control; for long-lived MP4 caching use
// Netlify (public/_headers), Vercel (vercel.json), or a CDN in front of the origin.

const VIDEO_CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

function videoCacheHeaders() {
  function apply(req, res) {
    const path = req.url?.split("?")[0] ?? "";
    if (path.includes("/videos/") && path.endsWith(".mp4")) {
      res.setHeader("Cache-Control", VIDEO_CACHE_CONTROL);
    }
  }
  return {
    name: "video-cache-headers",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        apply(req, res);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        apply(req, res);
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const site = env.VITE_SITE_URL?.trim().replace(/\/$/, "") || "";

  return {
    base: "./",
    build: {
      // Bundled JS (app + node deps); terser yields slightly smaller output than esbuild here.
      minify: "terser",
      terserOptions: {
        format: { comments: false },
      },
      // PostCSS (autoprefixer + cssnano in production) runs first; esbuild minifies the final CSS bundle.
      cssMinify: "esbuild",
    },
    plugins: [
      videoCacheHeaders(),
      {
        name: "html-open-graph",
        transformIndexHtml(html) {
          const block = /<!--\s*vite:og-absolute\s*-->[\s\S]*?<!--\s*\/vite:og-absolute\s*-->\s*/;
          if (site) {
            const base = `${site}/`;
            const img = `${site}/og.png`;
            return html
              .replace(block, (m) =>
                m
                  .replaceAll("__OG_SITE_URL__", base)
                  .replaceAll("__OG_IMAGE_URL__", img)
                  .replace(/<!--\s*vite:og-absolute\s*-->\s*/g, "")
                  .replace(/\s*<!--\s*\/vite:og-absolute\s*-->\s*/g, ""),
              )
              .replaceAll("__TWITTER_CARD__", "summary_large_image");
          }
          return html.replace(block, "").replaceAll("__TWITTER_CARD__", "summary");
        },
      },
    ],
  };
});
