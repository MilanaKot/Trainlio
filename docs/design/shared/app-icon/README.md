# Trainlio app icon

Product icon, independent of any club. Club logos (OrgLogo) appear only inside the app.

| File | Use |
|---|---|
| `favicon.svg` | `<link rel="icon" type="image/svg+xml">` (modern browsers) |
| `favicon.ico` | 16/32/48 fallback, `/favicon.ico` |
| `apple-touch-icon.png` | 180×180, full-bleed square (iOS adds the rounding) |
| `icon-192.png`, `icon-512.png` | PWA manifest, `purpose: "any"` |
| `icon-maskable-512.png` / `icon-maskable.svg` | PWA manifest, `purpose: "maskable"` (glyph in the 80 % safe zone) |

Next.js App Router: put `favicon.ico`, `icon.svg` (= favicon.svg) and `apple-icon.png` (= apple-touch-icon.png) in `app/`. Copy the PNGs to `public/icons/`.

```ts
// app/manifest.ts
export default function manifest() {
  return {
    name: "Trainlio", short_name: "Trainlio",
    start_url: "/", display: "standalone",
    theme_color: "#2B55E0", background_color: "#F3F5F9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```
