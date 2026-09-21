# @aglyn/plugins-video-delivery

Library video served from Cloudflare R2 through a Worker, behind
core's media delivery contract (`core.media-delivery` in
`@aglyn/aglyn/plugin-manager/media-delivery-provider`). Core makes every
access decision and never names a provider; this plugin holds the copies
and serves them.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

```bash
npm install @aglyn/plugins-video-delivery@beta
```

A plugin is loaded through Aglyn's plugin manager (`@aglyn/aglyn`) by the console and the tenant runtime; it is not a standalone library.

- `declarations.server.ts` — registers the provider at boot in both apps
  (`serverDeclarations` in `plugins.config.json`).
- `video-delivery-provider.ts` — the adapter: copies go to R2 through its S3
  API, and delivery URLs are minted on `MEDIA_VIDEO_DELIVERY_HOST`.
- `r2-object-store.ts`, `sigv4.ts` — the four S3 calls the copy flow makes,
  signed with SigV4 on Web Crypto. No SDK.
- `delivery-token.ts` — the one token format the platform mints and the
  Worker verifies.
- `worker/video-worker.ts` — the Worker. It verifies the token (expiry,
  signature and the object key it names) and serves the object from its
  bucket binding, with ranges and `HEAD`. `wrangler.jsonc` deploys it as the
  Worker `video`.

## Switches

Nothing here runs until all three are on:

1. The settings. `store` needs `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY` and `R2_VIDEO_BUCKET` — only where copies are
   written, which is the console. `deliver` needs `MEDIA_VIDEO_DELIVERY_HOST`
   and `MEDIA_VIDEO_DELIVERY_SECRET` wherever a URL is minted: the console and
   the tenant app. The secret is not `TOKEN_SIGNING_SECRET`, and the Worker
   holds the same value as its own secret.
2. The release flag `release_video_delivery`, per org. It gates copying as
   well as delivery.
3. A copy made from the asset's current bytes. Until one exists, the video
   serves from the platform as it always has.

## What stays true while this plugin is on

- Published pages admit the delivery host in `media-src` on their own
  (`mediaDeliveryOrigin` in the repo-root `security-origins.js`, which reads
  `MEDIA_VIDEO_DELIVERY_HOST` by the rules `videoDeliveryOrigin` applies; a
  spec here holds the two to the same answers). Without it the browser
  refuses the redirect.
- The platform's bucket keeps every video, and the storage counter counts it
  once; a copy's size is never added to it. Making the R2 copy the ONLY copy
  is a later step, and the storage cost model for video depends on that step
 .
- Cloudflare receives customer video and, in transit, the viewer's IP address
  and user agent. It must be on `/legal/subprocessors` before the flag is on
  for any customer. The owner decides and publishes that; this plugin
  declares no `subprocessors` entry until the page carries the row.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/video-delivery
