import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  zip: {
    excludeSources: ['docs/**', '.output/**', '.wxt/**'],
  },
  manifest: ({ browser }) => ({
    name: 'Page Anchor - Web Annotation & Drawing',
    description: 'Freehand drawing, shapes, and text annotations directly on web pages with persistent storage and customizable shortcuts.',
    version: '1.0.0',
    permissions: [
      'storage',
      'activeTab',
      ...(browser === 'firefox' || browser === 'safari' ? [] : ['scripting']),
    ],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'page-anchor@ayaanqadri.dev',
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['none'],
              },
            },
            gecko_android: {
              strict_min_version: '142.0',
            },
          },
        }
      : {}),
    icons: {
      16: '/icon-16.png',
      32: '/icon-32.png',
      48: '/icon-48.png',
      128: '/icon-128.png',
    },
    action: {
      default_title: 'Page Anchor',
      default_icon: {
        16: '/icon-16.png',
        32: '/icon-32.png',
        48: '/icon-48.png',
        128: '/icon-128.png',
      },
    },
    commands: {
      'toggle-drawing-mode': {
        suggested_key: {
          default: 'Alt+Shift+D',
          mac: 'Alt+Shift+D',
        },
        description: 'Toggle Page Anchor drawing toolbar',
      },
    },
  }),
});
