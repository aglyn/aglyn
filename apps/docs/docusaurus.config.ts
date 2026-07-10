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
          showLastUpdateTime: true,
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
  ],

  themeConfig: {
    image: 'img/aglyn-social-card.png',
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
      title: 'Aglyn Docs',
      logo: {
        alt: 'Aglyn',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
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
            { label: 'The Besigner', to: '/besigner/overview' },
            { label: 'Datasets', to: '/datasets/overview' },
            { label: 'Plugins', to: '/plugins/overview' },
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
