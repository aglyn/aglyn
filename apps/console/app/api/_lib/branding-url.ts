/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * What `/api/orgs/settings` will accept in an `OrgBrandingProfile` URL field
 * (AGL-2247).
 *
 * ## Why this is a module and not four lines inside the route
 *
 * A Next App Router `route.ts` may only export the handlers, so a helper
 * declared there cannot be reached by a spec — and the branding save had no
 * spec at all, which is how a validator that rejected its own picker's output
 * shipped. Pulling the predicates out is what makes them testable without
 * standing up a closed-world mock of auth, entitlements and Firestore around
 * the route just to assert a regex.
 *
 * ## The two shapes, and why there are two
 *
 * A branding URL is either NAVIGATED or RENDERED, and they do not have the
 * same rule.
 *
 * `supportUrl` is navigated — a link a customer clicks out to, often from an
 * inbox days later — so it must name a host and a scheme, and stays
 * https-only.
 *
 * `logoUrl`, `faviconUrl` and `emailLogoUrl` are rendered, and each carries a
 * "Browse" button onto the org media library. `MediaUrlField`'s `onPick`
 * hands back `media.cdnPath`, which is `/api/media/cdn/{scope}/{mediaId}` and
 * never absolute — so an https-only rule refused every asset the picker could
 * produce and left pasting a self-hosted URL by hand as the only way to save.
 * The relative form is first-class at every read site (`resolveMediaSrc` in
 * the console; `resolveEmailMediaSrc` + `imageSrc` in the email renderer,
 * which absolutizes it against the sending origin), so the validator was the
 * one reader that did not know the value was legal.
 *
 * Both remain ALLOWLISTS of exactly the shapes we mean. A bare hostname, an
 * `http://` URL, a `javascript:`/`data:` scheme, a protocol-relative
 * `//evil.example`, and a path pointing anywhere other than the media CDN are
 * all still refused.
 */

/** Mirrors the CDN route's own grammar — see `SEGMENT` in media-ref.ts. */
const MEDIA_CDN_PATH = /^\/api\/media\/cdn\/[A-Za-z0-9_:-]{1,131}\/[A-Za-z0-9_-]{1,64}$/

/** An absolute https URL, and nothing else. */
export function isBrandingLinkUrl(value: string): boolean {
  return /^https:\/\//i.test(value)
}

/**
 * An absolute https URL, or a media-library CDN path the picker produced.
 *
 * Order matters only for readability; the two shapes cannot overlap, because
 * a value starting `https://` can never also start `/api/`.
 */
export function isBrandingImageUrl(value: string): boolean {
  if (isBrandingLinkUrl(value)) return true
  return MEDIA_CDN_PATH.test(value)
}
