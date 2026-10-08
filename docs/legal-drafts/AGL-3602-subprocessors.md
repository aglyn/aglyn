# Subprocessors and Privacy: Create with AI in Media (AGL-3602)

**Status: APPROVED 2026-10-07, with Location "Global — Google selects where
requests are processed" (the default `global` Vertex AI endpoint, which makes
no processing-location promise) and the purpose worded as images rather than
photos. The final text is below.** SUB-1
and PP-1 are published together as legal v11 with re-acceptance; SUB-2 is not
applied (see below). The AI catalog declares the SUB-1 row dated 2026-10-07
(`AI_IMAGE_CATALOG_PROVIDERS` in `libs/plugins/ai/src/lib/providers/catalog.ts`),
so the subprocessor inventory carries `aiplatform.googleapis.com`.

The image-provider kinds of **Media → Create with AI** (Photo, Art and Design)
stay switched off in production (`AI_IMAGE_VERTEX_PROJECT` and
`NEXT_PUBLIC_AI_IMAGE_PHOTOS` unset) until both pages are live. The Vector
kinds use the existing AI text provider and need no change to run.

## What the code sends, read from the code

**Photos** (`libs/plugins/ai/src/lib/providers/vertex-image.ts`), one request
per picture to `aiplatform.googleapis.com` (Vertex AI, `global` location by
default, which Google may process anywhere), as Aglyn's own service account:

- the description the member typed, followed by the fixed style wording of
  the kind chosen (`libs/plugins/ai/src/lib/server/ai-media-raster-prompt.ts`:
  a photographic genre, an art style or a design asset; none for Photo) —
  text of ours that carries nothing of the workspace;
- the shape (one of 1:1, 4:3, 3:4, 16:9, 9:16) and the size the plan makes
  (512 px on Free, 1K on a paid plan, chosen by the server);
- fixed settings: image output only, Google's safety filters at "block some"
  on harassment, hate, sexually explicit and dangerous content.

Never sent: an account, member, organization or site identifier; an email
address; any other content of the site; any file from the media library.

What comes back: the picture (stored in the workspace's own media library
through the normal upload path) and token counts.

**Illustrations** (`libs/plugins/ai/src/lib/server/ai-media-svg.ts`) go to the
platform's AI text provider (Anthropic today): the description, the kind of
picture (illustration, icon, pattern or logo mark), the shape, and either the
site's theme colors as hex values or the colors the member picked.

## SUB-1 · New row: Google LLC (Google Cloud Vertex AI) — FINAL, ready to paste

Approved 2026-10-07 with the purpose worded as **images**, not photos: the same
request makes photographs, art (a watercolor, a 3D render) and design assets
(a banner, a social post graphic).

**Location.** Production uses Vertex AI's default `global` endpoint
(`aiplatform.googleapis.com`). Google's data residency page ("Where your data
lives and is processed", read 2026-10-07) says global endpoints "route and
process data anywhere globally, without restricting it to a specific
geographic region" and "don't provide regional isolation or data residency
guarantees". An earlier draft of this row said "United States and European
Union", which the global endpoint does not promise; the row therefore says
that Google selects the location. (`AI_IMAGE_VERTEX_LOCATION=us` or `eu`, the
multi-region endpoints that do keep processing in one jurisdiction, remain
available to a self-hosted operator; Aglyn's production leaves it unset.)

Placement: after the existing Google Cloud rows, before Anthropic.

| Subprocessor | Location | Purpose | Data processed |
| --- | --- | --- | --- |
| Google LLC (Google Cloud Vertex AI) | Global — Google selects where requests are processed | AI image generation: creating images for a customer's media library from a description a user writes | The description the user writes and the shape requested, and the generated image returned. No account identifiers, email addresses, or other content of the customer's site. |

**Change-log entry** (new first item):

> **October 7, 2026** — Added Google LLC (Google Cloud Vertex AI) for AI image
> generation: when a user creates an image in the media library, the
> description they write and the shape they choose are sent to Google's image
> models on Google Cloud Vertex AI, which processes each request at a location
> Google selects anywhere in the world, and the generated image is stored in
> the customer's media library.

The catalog row (`AI_IMAGE_CATALOG_PROVIDERS` in
`libs/plugins/ai/src/lib/providers/catalog.ts`) carries this wording dated
`2026-10-07`, pinned by `libs/plugins/ai/src/lib/subprocessors.spec.ts` and
`apps/console/constants/subprocessor-inventory-plugins.spec.ts`. If the page
goes live on another date, move `publishedOn` and both pins to it.

What reaches Google, read from the code: the description, followed by the
fixed style wording of the kind chosen (text of ours, carrying nothing of the
workspace; none for a plain Photo), the shape, and fixed settings. "The
description the user writes and the shape requested" is therefore exact, and
no account, member, organization or site identifier, email address, theme
color, other site content or media file is sent.

## PP-1 · Privacy Policy — FINAL, ready to paste

**§2 "What AI features send"**: add this sentence after the theme-change
clause:

> For creating images in your media library other than SVG illustrations, we
> send your description and the shape you choose to Google, our provider for
> image generation, and nothing else from your account or site; for SVG
> illustrations, icons, patterns and logo marks, we send our AI provider your
> description, the kind and shape of picture, and your site's theme colors or
> the colors you choose.

**§3**, only if it lists the providers AI features use (the v3 change edited a
"provider bullet" there, so check the live text): add Google beside the AI
provider it names:

> Google (Google Cloud Vertex AI), for creating images in your media library
> from a description you write.

Privacy is acceptance-pinned (`apps/console/constants/legal-documents.ts`),
so publishing this is legal v11: publish the masters and the page first,
capture the live page, archive it under
`Platform Docs/Legal/Acceptance-Snapshots/v11/`, then bump
`LEGAL_DOCUMENT_VERSION` to `v11` with the new privacy hash and bytes, as
AGL-3520 did for v10. Both pages and their `/legal` cards read October 7,
2026.

## SUB-2 (optional) · Anthropic row

**Not applied with v11.** The draft does not call it required: the Anthropic
row's "such as" purpose and its data cell (a brief and the theme's colors)
already cover the SVG kinds. Apply it at the next republish of that row.

The Anthropic purpose cell lists AI generation's outputs with "such as", and
its data cell already names a brief and the theme's colors. Illustrations are
covered by that wording; naming them explicitly at the next republish would
read:

- Purpose, after "theme changes": "illustrations, icons, patterns and simple
  logo marks drawn as SVG for the media library,"
- Data processed, after the theme-change sentence: "For an illustration in the
  media library, the description, the kind and shape of the picture, and the
  site's theme colors or colors the user chose."

## Other documents

- DPA: unchanged. §7.1 makes the Subprocessors page Annex III, so SUB-1 is
  the change.
- Terms and AUP: unchanged. The AUP already governs what users may generate.
