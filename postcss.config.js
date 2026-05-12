const production = process.env.NODE_ENV === "production";

export default {
  plugins: {
    // Vendor prefixes for target browsers (see .browserslistrc).
    autoprefixer: {},
    // Extra safe transforms + comment stripping; Vite still runs `build.cssMinify` after PostCSS.
    ...(production ? { cssnano: { preset: "default" } } : {}),
  },
};
