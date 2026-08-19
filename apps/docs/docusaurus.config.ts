import { themes as prismThemes } from 'prism-react-renderer'
import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

// The GitHub repo docs live in — used for the "Edit this page" links.
const editUrl = 'https://github.com/aglyn/aglyn/tree/main/apps/docs/'

/**
 * SELF-HOST CONFIGURATION (AGL-2124).
 *
 * `apps/docs` ships in the open-source distribution and an operator can build
 * and publish it as their own product documentation. Three values in it were
 * bare literals, and none of them was cosmetic: each made a self-hosted docs
 * site REPORT TO AGLYN.
 *
 * The load-bearing rule for every one of them is the same: **unset means OFF,
 * never ours.** A missing analytics id must mean "no analytics"; it must never
 * mean "Aglyn's". Wrong in both directions otherwise — the operator gets
 * nothing of their own, and our September activation funnel is polluted by
 * traffic from installs we do not run (the AGL-2064/2067 corruption, from a
 * source those fixes did not consider).
 *
 * `trim() || undefined` throughout so a half-finished `.env` line reads as
 * absent rather than as an empty tag id.
 */
const env = (name: string): string | undefined =>
  (process.env[name] ?? '').trim() || undefined

/**
 * GA4 measurement id. UNSET → the `gtag` preset option is `undefined`, so
 * Docusaurus loads no tag at all. Aglyn's own docs project sets this in its
 * Vercel project like any other operator would.
 */
const docsGaTrackingId = env('DOCS_GA_TRACKING_ID')

/**
 * Where browser errors are POSTed. UNSET → the beacon installs NO handlers.
 * Delivered to client code through `customFields`, because Docusaurus does not
 * expose arbitrary `process.env` to browser bundles and a bespoke DefinePlugin
 * for one string would be a second mechanism.
 */
const docsErrorBeaconEndpoint = env('DOCS_ERROR_BEACON_ENDPOINT')

/**
 * Comma-separated `name|label|origin|description` targets the /status page
 * probes. UNSET → it probes nothing and says so, instead of live-probing
 * Aglyn's infrastructure and reporting OUR uptime as the operator's.
 */
const docsStatusTargets = env('DOCS_STATUS_TARGETS')

const config: Config = {
  title: 'Aglyn Docs',
  tagline: 'Build and run your site with Aglyn — the no-code website platform',
  favicon: 'img/favicon.ico',

  // The canonical origin this build publishes itself at (AGL-2124). An
  // operator's docs advertising `docs.aglyn.com` as their canonical would send
  // their readers, and every crawler, to us.
  url: env('DOCS_URL') ?? 'https://docs.aglyn.com',
  baseUrl: '/',

  organizationName: env('DOCS_ORGANIZATION_NAME') ?? 'aglyn',
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

  // First-party error beacon (AGL-1646): uncaught JS errors on the docs —
  // the surface that IS the activation path — post to the console's
  // existing collector. Standalone copy of the lib beacon's wire format
  // (this app cannot import libs/ — AGL-1595); armed in production builds
  // only, PII-free by construction. See src/error-beacon.ts.
  clientModules: ['./src/error-beacon.ts'],

  // The one channel Docusaurus offers from build config to browser code
  // (AGL-2124). Read via `useDocusaurusContext().siteConfig.customFields`.
  customFields: {
    errorBeaconEndpoint: docsErrorBeaconEndpoint ?? null,
    statusTargets: docsStatusTargets ?? null,
  },

  // `content_group: 'docs'` (AGL-1857): the GA4 axis that separates docs
  // traffic from `marketing` and `console` in standard reports. The gtag
  // preset below accepts no config params, so the group is queued as a
  // `gtag('set')` into the SAME dataLayer the preset's snippet creates —
  // `set` applies to every event processed after it in queue order, which
  // covers the route-change `page_view`s the drop-off metric is read from.
  // Whether the FIRST pageview of a session carries it depends on where
  // Docusaurus renders config headTags relative to the preset's snippet;
  // best-effort there, and Hostname still separates the domains fully.
  //
  // `traffic_type: 'internal'` (AGL-2064) rides the same queue, for the same
  // reason and with the same best-effort caveat. Dev builds were already safe
  // — the gtag plugin returns null unless `NODE_ENV === 'production'` and this
  // project has non-production git deployments disabled — but PRODUCTION
  // `docs.aglyn.com` was not: we read our own docs constantly while building,
  // logged out, and every one of those visits counted as a real reader in the
  // property the September activation funnel is read from.
  //
  // Opt a browser in with `?aglyn_internal=1` on any docs URL. `localStorage`
  // is origin-scoped, so this is a separate opt-in from `aglyn.com` and
  // `app.aglyn.com` — see docs/ANALYTICS.md §8.
  //
  // ⚠️ The snippet is a VERBATIM COPY of `INTERNAL_TRAFFIC_GTAG_SNIPPET` in
  // `libs/aglyn/src/lib/app-utils/internal-traffic.ts`, because this app
  // cannot import from `libs/` (AGL-1595) — the same constraint that puts the
  // measurement id in source below. `apps/console/specs/docs-internal-traffic-
  // snippet.spec.ts` fails if the two ever drift, so the copy is checked
  // rather than trusted: a stale copy here would read as a working stamp and
  // stamp nothing, which no report would show.
  headTags: [
    {
      tagName: 'script',
      attributes: {},
      // The canonical gtag queue shape: gtag.js processes `arguments`
      // objects, NOT plain arrays — `dataLayer.push(['set', …])` is the
      // classic silent no-op.
      innerHTML:
        'window.dataLayer=window.dataLayer||[];' +
        'function gtag(){dataLayer.push(arguments);}' +
        "gtag('set',{'content_group':'docs'});" +
        "try{var aq=new URLSearchParams(location.search).get('aglyn_internal');if(aq!==null){if(['0','false','off','no'].indexOf(aq.toLowerCase())>=0)localStorage.removeItem('aglyn_traffic_type');else localStorage.setItem('aglyn_traffic_type','internal');}if(localStorage.getItem('aglyn_traffic_type')==='internal')gtag('set',{'traffic_type':'internal'});}catch(e){}",
    },
  ],

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
        // Google Analytics (AGL-1579). Third first-party surface on the ONE
        // consolidated property (AGL-1559): `G-YW5PG16YTM`, property 302497406,
        // web stream 3230351080 — the same measurement id `aglyn.com` and
        // `app.aglyn.com` already report to. A fourth property was the tempting
        // shape and the wrong one: the `_gl` linker is honoured per-tag, so a
        // second id would hand a visitor a fresh `client_id` on the domain hop
        // and turn "read the docs, then signed up" into two unrelated users.
        // Separate the three surfaces in reports with the built-in Hostname
        // dimension.
        //
        // Why the id is written here rather than read from an env var: this app
        // is its own Vercel project (`aglyn-docs`, root directory `apps/docs`)
        // and it has NO environment variables configured at all — it does not
        // share the console's `NEXT_PUBLIC_*` surface, and `NEXT_PUBLIC_` is a
        // Next.js convention that means nothing to Docusaurus anyway. An env
        // var nobody has set is analytics that silently reports zero, which is
        // the exact failure this issue exists to end: zero is indistinguishable
        // from nobody reading the docs. The id is a public identifier, already
        // served in the HTML of both other domains.
        //
        // Dev and preview builds cannot pollute the property. The plugin
        // returns `null` unless `NODE_ENV === 'production'`, so `docusaurus
        // start` loads no tag; and this project has non-production git
        // deployments disabled outright (see vercel.json), so there are no
        // preview URLs to leak hits either.
        //
        // The plugin's client module also re-sends `page_view` on SPA route
        // changes. That is not a nicety here — Docusaurus hands over to
        // client-side routing after the first paint, so a bare gtag snippet
        // would count one pageview per SESSION and report the whole
        // getting-started path as a single page. Drop-off between guides is the
        // metric, and it only exists because of that hook.
        //
        // CONSENT: unconditional, matching `app.aglyn.com` (AGL-118) rather
        // than `aglyn.com`. That is adopting one of the two existing postures,
        // not inventing a third. `aglyn.com` is gated because it is served by
        // the TENANT runtime, where the gate is host-configured machinery — a
        // Firestore `consent.mode`, `/api/consent/region`, and a stored record
        // keyed per hostId in localStorage. None of it exists on a static site,
        // and localStorage is origin-scoped, so a choice a visitor made on
        // `aglyn.com` is unreachable from `docs.aglyn.com` regardless. Porting
        // that stack here would be a THIRD implementation of consent, which is
        // the outcome AGL-1579 explicitly rules out. Docs is a first-party
        // Aglyn surface under our own privacy policy, exactly as the console
        // is.
        //
        // `anonymizeIP` emits `'anonymize_ip': true` on the config call. GA4
        // IGNORES it — IP anonymization is unconditional there and cannot be
        // switched off. Kept because it is free and honest about intent, but it
        // is NOT the privacy control: that is property-level (Google Signals
        // off, ads personalization 0/307 regions, no Ads link, 14-month
        // retention, email redaction on) and documented in docs/ANALYTICS.md.
        //
        // AGL-2124: `undefined` when `DOCS_GA_TRACKING_ID` is unset, so an
        // operator's build loads NO tag. It used to be a bare literal — our
        // measurement id — so every operator who ran `docusaurus build`
        // shipped OUR tag and reported their readers into our property.
        gtag: docsGaTrackingId
          ? { trackingID: docsGaTrackingId, anonymizeIP: true }
          : undefined,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      // Separate "API" docs instance (AGL-611): the REST API reference lives
      // at /api with its own sidebar, distinct from the product docs.
      '@docusaurus/plugin-content-docs',
      {
        id: 'api',
        path: 'api',
        routeBasePath: 'api',
        sidebarPath: './sidebarsApi.ts',
        editUrl,
      },
    ],
    [
      // "Learn" instance (AGL-612): guided learning paths at /learn.
      '@docusaurus/plugin-content-docs',
      {
        id: 'learn',
        path: 'learn',
        routeBasePath: 'learn',
        sidebarPath: './sidebarsLearn.ts',
        editUrl,
      },
    ],
    [
      // "Help" instance (AGL-613): support, FAQ, troubleshooting at /help.
      '@docusaurus/plugin-content-docs',
      {
        id: 'help',
        path: 'help',
        routeBasePath: 'help',
        sidebarPath: './sidebarsHelp.ts',
        editUrl,
      },
    ],
    [
      // Offline/local full-text search (no external Algolia dependency).
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        // Index every docs instance.
        docsRouteBasePath: ['/', '/api', '/learn', '/help'],
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
      // The navbar now matches the console app bar — light in light mode, dark
      // in dark mode (AGL-633) — so each mode needs its own wordmark: the
      // dark-word variant on the light bar (`src`), the light-word variant on
      // the dark bar (`srcDark`). Docusaurus swaps them by color mode.
      logo: {
        alt: 'Aglyn Documentation',
        src: 'img/aglyn-docs-logo.svg',
        srcDark: 'img/aglyn-docs-logo-dark.svg',
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
          type: 'docSidebar',
          sidebarId: 'apiSidebar',
          docsPluginId: 'api',
          position: 'left',
          label: 'API',
        },
        {
          type: 'docSidebar',
          sidebarId: 'learnSidebar',
          docsPluginId: 'learn',
          position: 'left',
          label: 'Learn',
        },
        {
          type: 'docSidebar',
          sidebarId: 'helpSidebar',
          docsPluginId: 'help',
          position: 'left',
          label: 'Help',
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
          href: 'https://github.com/aglyn/aglyn',
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
        // Trust and Status shipped with the enterprise readiness work but were
        // reachable only by typing the URL — nothing in the navbar, footer or
        // sidebar pointed at either. They are the two pages a procurement
        // review looks for first, so they get their own column rather than
        // being appended to "More".
        {
          title: 'Trust',
          items: [
            { label: 'Trust & security', to: '/trust' },
            { label: 'Status', to: '/status' },
            { label: 'Enterprise', to: '/enterprise' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/aglyn/aglyn' },
            { label: 'Contributing to docs', href: 'https://github.com/aglyn/aglyn/blob/main/apps/docs/CONTRIBUTING.md' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} ${
        env('DOCS_ORGANIZATION_NAME') ?? 'Aglyn LLC'
      }. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'tsx'],
    },
  } satisfies Preset.ThemeConfig,
}

export default config
