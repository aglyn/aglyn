# @aglyn/plugins-weglot

Weglot translation for a merchant's published Aglyn site, with the merchant's
own Weglot account and public project key (AGL-3700). Aglyn holds no Weglot
account and no Aglyn server calls Weglot.

> Published to npm from the Aglyn monorepo. Versions follow [semantic versioning](https://semver.org).

## Install

```bash
npm install @aglyn/plugins-weglot
```

A plugin is loaded through Aglyn's plugin manager (`@aglyn/aglyn`); it is not a standalone library.

- `model/weglot-settings.ts` — the settings schema the console's generic
  settings card draws, and the one parse the server and the page share.
- `server/site-page-enricher.ts` — decides whether a published page carries
  Weglot: the site switched the plugin on, the plan has `multilingual`, and
  the settings are valid.
- `weglot-loader.ts` — the inline boot and loader: Weglot's script starts at
  once for a returning visitor who chose a translation, and after the page has
  loaded and gone idle for everyone else.
- `components/weglot-site-runtime.tsx` — the site runtime and the themed
  language switcher.
- `subprocessors.ts` — Weglot's hosts, merchant-provided (not an Aglyn
  sub-processor).

Client-side translation only: no `hreflang` for Weglot's languages and no
Weglot subdomain or subdirectory mode.
