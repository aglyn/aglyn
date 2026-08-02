# My plugin

> This README doubles as your **marketplace listing documentation** —
> Aglyn renders it on your plugin's detail page. Cover what the plugin
> does, how to set it up, and what data/network access it needs. Replace
> everything in this template before publishing.

One paragraph: what the plugin does and who it's for.

## Setup

1. Install from the Aglyn marketplace marketplace.
2. Enable it on the organization's **Plugins & add-ons** page (installs
   enable automatically).
3. Any configuration steps your plugin needs.

## What it adds

- Console: …
- Site: …

## Data & permissions

Be explicit: what the plugin reads/writes, and every network host in the
manifest `capabilities.network` allowlist.

---

## Developing (delete this section before publishing)

```bash
npm install
npm run build      # → dist/plugin.bundle.mjs
npm run watch      # rebuild on save
```

- Entry contract: export `register(host)` (client surfaces) and/or
  `registerApi()` (server handlers — rarely needed, gated off by default
  platform-side).
- `react`, `react/jsx-runtime`, and `@aglyn/aglyn` compile to lookups on
  the host ABI (`__AGLYN_PLUGIN_HOST__`); the emitted bundle must have no
  other imports.
- Keep `manifest.json` in step: `id` (stable, kebab-case), `version`
  (bump every publish — artifacts are immutable), `capabilities`.
- Publish through the Aglyn console: **Marketplace → Publish → "A plugin
  (upload a bundle)"** — upload `dist/plugin.bundle.mjs` + this
  `manifest.json`. The platform content-addresses your bundle (sha256)
  and reviews it; staff-signed listings may run in the trusted realm
  tier, everything else runs in the sandboxed PluginFrame.
