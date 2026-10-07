# Subprocessors and Privacy: Create with AI in Media (AGL-3602)

**Status: APPROVED 2026-10-07 as drafted, with Location "United States and
European Union" (option 1, the default `global` Vertex AI location).** SUB-1
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
default), as Aglyn's own service account:

- the description the member typed, followed by the fixed style wording of
  the kind chosen (`libs/plugins/ai/src/lib/server/ai-media-raster-prompt.ts`:
  a photographic genre, an art style or a design asset; none for Photo) —
  text of ours that carries nothing of the workspace;
- the shape (one of 1:1, 4:3, 3:4, 16:9, 9:16) and the 1K size;
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

## SUB-1 · New row: Google LLC (Google Cloud Vertex AI)

Placement: after the existing Google Cloud rows, before Anthropic.

| Subprocessor | Location | Purpose | Data processed |
| --- | --- | --- | --- |
| Google LLC (Google Cloud Vertex AI) | United States and European Union | AI image generation: creating photos for a customer's media library from a description a user writes | The description the user writes and the shape requested, and the generated image returned. No account identifiers, email addresses, or other content of the customer's site. |

**Decision needed on Location.** With the default `global` location Google
lists the model's processing as multi-region US and EU, so "United States"
alone would be wrong. Two ways to keep "United States":

1. publish the row as drafted ("United States and European Union"); or
2. pin requests to Google's US multi-region and publish "United States". The
   adapter does not yet support the multi-region host (it accepts `global` or
   a single region such as `us-central1`, which Google does not list for this
   model). It would need the endpoint form Google documents for multi-region
   `us`, verified first.

**Change-log entry** (new first item):

> **<PUBLISH DATE>** — Added Google LLC (Google Cloud Vertex AI) for AI image
> generation: when a user creates a photo in the media library, the
> description they write and the shape they choose are sent to Google's image
> models, and the generated image is stored in the customer's media library.

After publishing: set the row's date as `publishedOn` in a catalog provider row
for `google-vertex` (`libs/plugins/ai/src/lib/providers/catalog.ts`, the way
the Anthropic row is declared), so the subprocessor inventory carries the host
`aiplatform.googleapis.com`, then set the two environment variables.

**Wording note for the publisher (2026-10-07).** The approved purpose cell and
PP-1 say "photos". The same request now also makes art (a watercolor, a 3D
render) and design assets (a banner, a social post graphic), which a reader
would not call photos. Both still describe the recipient and the data exactly;
if "photos" is changed to "images" (purpose: "creating images for a
customer's media library from a description a user writes"; PP-1: "For
creating images other than SVG illustrations in your media library, …"), make
the same change to `AI_IMAGE_CATALOG_PROVIDERS` and the two specs that pin it
in the same commit as the v11 pins.

## PP-1 · Privacy Policy §2 "What AI features send"

§2 speaks of "the provider" as one recipient. Add one sentence after the
theme-change clause:

> For creating photos in your media library, we send your description and the
> shape you choose to Google, our provider for image generation, and nothing
> else from your account or site; for illustrations, we send the provider your
> description, the kind and shape of picture, and your site's theme colors or
> the colors you choose.

If §3 lists the providers AI features use, add Google there for image
generation as well. Privacy is acceptance-pinned
(`apps/console/constants/legal-documents.ts`), so publishing this is a
version bump (v11), a re-capture of the live page, and a re-acceptance — the
pattern AGL-3520 followed for v10.

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
