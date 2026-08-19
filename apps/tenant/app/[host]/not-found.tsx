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

import SiteNotFound from '../../components/site-not-found.component'

/**
 * The tenant's branded 404 (AGL-2074).
 *
 * ## When this renders
 *
 * On EVERY unmatched path (AGL-2342). `page.tsx` calls `notFound()` whenever
 * `load-page-data` resolves no screen and no collection entry, and there is no
 * longer a second exit that bypasses this boundary.
 *
 * There used to be: a host with `errorScreens.notFound` bound got its designed
 * screen back from the loader as ordinary props — a `200 OK` carrying
 * `noindex`. Two things were wrong with that. The status was a lie, and it was
 * a lie nobody was collecting on: measured on production 2026-08-19,
 * `errorScreens` was unset on all six hosts, so the branch had never once
 * fired and every 404 on the platform was the fallback below.
 *
 * The designed screen now arrives THROUGH this boundary instead, so it and the
 * real `404` status ship together. `SiteNotFound` holds the whole mechanism
 * and the two measured framework facts that force it.
 *
 * ## Why it lives at `[host]/` and not at the app root
 *
 * Placement is the whole design. A not-found boundary renders inside its
 * segment's layout, and `[host]/layout.tsx` is where the host is resolved:
 * put here, the 404 inherits `HostThemeProvider` (the site's colors and
 * fonts), the site's favicon and manifest links, and — via
 * `HostBrandProvider` — its logo and name. Put at `app/`, it would render
 * above all of that and could only ever be generic. The root boundary still
 * exists for requests that never resolve a host; it is deliberately the
 * plainer one.
 *
 * AGL-2187 leaned on that placement again: the site's public top-level pages
 * ride the same context down from the layout, so the FALLBACK renders a real
 * header, nav and footer instead of a single button. `SiteStatusScreen` has
 * the whole rule, including why the site's AUTHORED nav cannot appear on it
 * and what is offered in its place. AGL-2342 leans on it a third time: the
 * host key the designed screen is fetched by rides down the same context.
 *
 * ## Status code
 *
 * Next emits a real 404 for this boundary, which is what `x-matched-path:
 * /[host]/[[...slug]]` returning `HTTP/2 404` on `https://aglyn.com/edit-access`
 * already showed — the status was never the defect. The BODY was, and still
 * partly is: Next 16 serves `notFound()` as an empty `__next_error__` document
 * and lets the client render this boundary from the flight payload. That is
 * measured, not assumed, and it is why nothing here can be server-rendered —
 * see `SiteNotFound`.
 *
 * What must NOT be "fixed" by rendering this content from `page.tsx` instead:
 * that trades the 404 for a 200, and a soft-404 tells every crawler a mistyped
 * URL is a real page.
 */
export default function HostNotFound() {
  return (
    <SiteNotFound
      code="404"
      title={'We can’t find that page'}
      message={
        'The link may be out of date, or the page may have been moved or ' +
        'removed. Everything else on the site is still here.'
      }
    />
  )
}
