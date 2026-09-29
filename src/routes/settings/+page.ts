// Prerendering this route would bake one language into the static HTML —
// whichever locale the build machine happened to report — and the browser
// would paint that for a frame before hydration switched to the stored one.
// Same reason /b, /changelog and /notebook are already client-only.
export const ssr = false;
