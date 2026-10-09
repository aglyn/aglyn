# @aglyn/plugins-stock-photos

Stock photo libraries behind core's stock photo contract (`core.stock-photos`
in `@aglyn/aglyn/plugin-manager/stock-photo-provider`). Core and the AI plugin
ask the contract for a library and never name one; Pixabay is the first.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

```bash
npm install @aglyn/plugins-stock-photos@beta
```

A plugin is loaded through Aglyn's plugin manager (`@aglyn/aglyn`) by the console; it is not a standalone library.

- `declarations.console-server.ts` — registers the Pixabay provider at the
  console's boot (`consoleServerDeclarations` in `plugins.config.json`). The
  tenant runtime never loads it.
- `providers/pixabay.ts` — the wire: the search, the answer's shape, the rate
  limit and the image fetch, which goes only to Pixabay's image hosts.
- `server/search-cache.ts` — every search answer kept 24 hours in
  `stockPhotoSearches/{key}` (Firestore TTL on `expiresAt`), as Pixabay's
  terms ask.
- `pixabay-provider.ts` — the two together, as core's provider, with the
  credit an asset records.

## Switch

Nothing runs until the console holds `PIXABAY_API_KEY`. Without it the
provider answers as absent, and the AI site build places the starter photos.

## Pixabay's terms, and how they are kept

- No hotlinking: a chosen photo is downloaded and stored in the site's own
  media library through core's media ingest (`core.media-ingest`), once per
  site; a page never names a Pixabay address.
- Requests cached 24 hours: `server/search-cache.ts`.
- The rate limit: the client reads `X-RateLimit-*` on every answer, keeps a
  margin, and stops asking until the window resets; a 429 stops it for the
  window named.
- Credit: every copied asset records the photographer, the photo's Pixabay
  page and the license (`stockPhoto` on the media document) and a credit
  sentence in its description. The Pixabay Content License asks no credit,
  and no search result is ever shown to anyone.
