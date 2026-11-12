import type { MetadataRoute } from 'next'

/**
 * The installable app (handoff v3.3, decision 37). Trainlio's own icon, never
 * a club's: the club's mark belongs inside the app (OrgLogo), and an icon on a
 * home screen is the product's.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Trainlio',
    short_name: 'Trainlio',
    start_url: '/',
    display: 'standalone',
    theme_color: '#2B55E0',
    background_color: '#F3F5F9',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
