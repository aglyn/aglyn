# Promo Countdown

A live **"sale ends in…"** countdown banner you can drop onto any tenant site.
It's a complete, self-contained example marketplace plugin — everything you need
to publish is in this folder.

![slot: page element + hostActivity widget](.)

## What it demonstrates

The full sandbox bundle contract, without a build step:

| Contract piece | Where |
| --- | --- |
| `default render({ mount, props, scheme, emit, hostFetch })` | the tenant sandbox entry — vanilla DOM, returns a cleanup fn |
| `register(host)` | console/realm entry — registers a preview widget via the host ABI |
| `props` | `title`, `targetIso`, `expiredText`, `accent`, `ctaLabel`, `ctaEvent` |
| `scheme` | light/dark theming from the host |
| `emit(name, payload)` | fires `expired` (once, at zero) and a CTA event on click |
| cleanup | `clearInterval` so prop/theme re-renders never leak timers |

No static imports, no `eval`/`Function`, no browser storage, no cookies — so
`src/index.js` **is** the shippable bundle. `dist/plugin.bundle.mjs` is a
byte-for-byte copy (there's nothing to compile because `react`/`@aglyn` are
only touched through the host ABI).

## Files

```
promo-countdown/
├── manifest.json              # id / version / entry / capabilities
├── src/index.js               # authored source
└── dist/plugin.bundle.mjs     # the bundle you upload (copy of src/index.js)
```

## Verify

Run the same static checks the publish API enforces:

```bash
node tools/scripts/verify-plugin-bundle.mjs examples/plugins/promo-countdown/dist/plugin.bundle.mjs
```

Expected: a `✓` for every area it checks — including `Network calls match
the manifest`, read from `manifest.json` beside the bundle — then
`Bundle OK.` and the sha256 (the content pin every install verifies).

## Publish

Console → **Marketplace → Publish → A plugin (upload a bundle)**. Upload
`dist/plugin.bundle.mjs`, paste `manifest.json`, fill in the listing name and
description, then submit. New listings enter the **review queue** as
`submitted`; staff list (or verify ✅) them before they appear in Browse.

Publishing needs a marketplace publisher profile, a Pro plan, and — for paid
listings — payouts onboarding. There's a daily publish cap.

## Configure on a site

Place the **Promo Countdown** element and set its props, e.g.

```json
{
  "title": "Spring sale",
  "targetIso": "2026-08-01T00:00:00Z",
  "expiredText": "Sale's over — see you next time!",
  "accent": "#e11d48",
  "ctaLabel": "Shop now",
  "ctaEvent": "cta"
}
```

Wire the `expired` / `cta` events to interactions (`plugin:<listingId>:<event>`)
to trigger navigation, a toast, or anything else in the command bus.
