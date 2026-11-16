import { defineConfig } from '@rspress/core';

export default defineConfig({
  root: 'docs',
  base: '/nexote/',
  title: 'Nexote',
  description:
    'A self-hosted, mobile-first markdown editor, heavily influenced by Obsidian.',
  icon: '/logo.svg',
  logo: '/logo.svg',
  logoText: 'Nexote',
  themeConfig: {
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/2TAP2B/nexote',
      },
    ],
    editLink: {
      docRepoBaseUrl: 'https://github.com/2TAP2B/nexote/tree/main/docs/docs',
    },
    footer: {
      message: 'Nexote is free software, licensed under the AGPL-3.0.',
    },
  },
});
