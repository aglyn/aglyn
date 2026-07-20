import { themes as prismThemes } from 'prism-react-renderer'
import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

// The GitHub repo docs live in — used for the "Edit this page" links.
const editUrl = 'https://github.com/aglyn/core/tree/main/apps/docs/'

const config: Config = {
  title: 'Aglyn Docs',
  tagline: 'Build and run your site with Aglyn — the no-code website platform',
  favicon: 'img/favicon.ico',

  // Set to the production URL once the Vercel project is linked.
  url: 'https://docs.aglyn.com',
  baseUrl: '/',

  organizationName: 'aglyn',
  projectName: 'core',

  // Fail the build on broken internal links so bad cross-references never ship.
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'warn',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          // Docs-only mode: docs are served from the site root.
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl,
          // Last-updated stamps shell out to `git log` per doc. Two
          // gotchas keep them honest (AGL-454):
          // - Nx caches docs:build on file CONTENTS, so the build target
          //   also hashes the HEAD commit (see project.json inputs) —
          //   otherwise a post-commit rebuild replays pre-commit dates.
          // - Vercel's default shallow clone has no usable history (the
          //   project root is apps/docs); set VERCEL_DEEP_CLONE=true in
          //   the Vercel project env to enable the stamps in prod.
          showLastUpdateTime:
            !process.env.VERCEL || process.env.VERCEL_DEEP_CLONE === 'true',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      // Offline/local full-text search (no external Algolia dependency).
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
    // Click-to-enlarge (lightbox) for every content image (AGL-609).
    // NOTE: this plugin reads its options from themeConfig.zoom (below),
    // not from plugin-array options.
    'docusaurus-plugin-image-zoom',
  ],

  themeConfig: {
    image: 'img/aglyn-social-card.png',
    // Click-to-enlarge for content images (docusaurus-plugin-image-zoom,
    // AGL-609). Skip inline/emphasis images; dim to the console slate.
    zoom: {
      selector: '.markdown :not(em) > img',
      background: {
        light: 'rgba(22, 28, 33, 0.65)',
        dark: 'rgba(0, 0, 0, 0.8)',
      },
    },
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    // Mermaid diagrams themed to the console palette (console.theme.ts):
    // primary = #404C5C nodes, secondary = #00b0ff accents/lines.
    mermaid: {
      theme: { light: 'base', dark: 'base' },
      options: {
        themeVariables: {
          primaryColor: '#404C5C',
          primaryTextColor: '#FFFFFF',
          primaryBorderColor: '#2C3540',
          secondaryColor: '#00b0ff',
          secondaryTextColor: '#FFFFFF',
          tertiaryColor: '#F8F9FA',
          lineColor: '#00b0ff',
          fontFamily: 'Roboto, system-ui, sans-serif',
        },
      },
    },
    navbar: {
      // The wordmark carries the name (AGL-449), so no navbar title text.
      // The console-themed navbar is dark slate in BOTH color modes, so
      // both modes use the light-word variant (aglyn-docs-logo.svg is the
      // dark-word one for light surfaces elsewhere).
      logo: {
        alt: 'Aglyn Documentation',
        src: 'img/aglyn-docs-logo-dark.svg',
        height: 24,
        width: 220,
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/developers/plugins/overview',
          label: 'Developers',
          position: 'left',
        },
        {
          to: '/whats-new',
          label: "What's New",
          position: 'left',
        },
        {
          href: 'https://github.com/aglyn/core',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Learn',
          items: [
            { label: 'Getting Started', to: '/getting-started/create-a-site' },
            { label: "What's New", to: '/whats-new' },
          ],
        },
        {
          title: 'Build',
          items: [
            { label: 'The Besigner', to: '/building-sites/besigner/overview' },
            { label: 'Datasets', to: '/content-and-data/datasets/overview' },
            { label: 'Plugins', to: '/developers/plugins/overview' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/aglyn/core' },
            { label: 'Contributing to docs', href: 'https://github.com/aglyn/core/blob/main/apps/docs/CONTRIBUTING.md' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Aglyn LLC. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'tsx'],
    },
  } satisfies Preset.ThemeConfig,
}

export default config
