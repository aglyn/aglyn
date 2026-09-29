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

// A leaf of its own (AGL-3401): `media-ref.ts` is on every published page and
// needs this one constant, and reaching it through `host-naming.ts` put the
// subdomain policy and the phishing screen's brand list on every page too.

/**
 * The apex tenant sites are served from. Console lives on `app.aglyn.com`.
 *
 * CONFIGURABLE, not a literal (AGL-2121). AGL-2022 moved the console's
 * *display* links onto `NEXT_PUBLIC_TENANT_DOMAIN` and shipped a green spec
 * for it; this constant — which every OTHER consumer reads — stayed a bare
 * `'aglyn.app'`. So a self-hoster who set the variable got correct "View live"
 * links in their own console while the software went on emitting our apex
 * everywhere that actually reaches the public: `<link rel="canonical">`,
 * `/api/sitemap`, `/api/robots`, `/api/collections-rss` item links,
 * `/api/manifest`, `og:image`, and the origin inbox-bound `<img src>` resolves
 * against. Their customers' sites told Google, every feed reader and every
 * inbox that they lived at a name the operator does not control and we do not
 * serve for them.
 *
 * Same variable and same default as `tenant-links.ts` — one value, one name
 * (AGL-733). Dot notation is load-bearing: this module reaches client bundles,
 * and Next inlines `NEXT_PUBLIC_*` by substituting `process.env.NAME`
 * textually; the bracket form is never substituted and would read `undefined`
 * in the browser. Trimmed so a half-finished `.env` line reads as absent
 * rather than as a whitespace apex.
 *
 * The asymmetry with `operator-identity.ts` — which refuses to default at all
 * — is deliberate. A wrong apex is visible to the operator on the first click
 * in their own console, so a default they can see and correct is a default. A
 * wrong contact address fails silently and off-site, which is why that one
 * refuses to guess.
 */
export const TENANT_APEX =
  (process.env.NEXT_PUBLIC_TENANT_DOMAIN || '').trim() || 'aglyn.app'
