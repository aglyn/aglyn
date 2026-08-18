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

import SiteStatusScreen from '../../components/site-status-screen.component'

/**
 * The tenant's branded 404 (AGL-2074).
 *
 * ## When this renders, and when it must NOT
 *
 * `page.tsx` calls `notFound()` when `load-page-data` resolves no screen,
 * no collection entry and no designated not-found screen. A host that HAS
 * designated one (`host.errorScreens.notFound`, AGL-131) never reaches here
 * at all — the loader returns that screen's composed nodes with a 200 and the
 * visitor gets the real designed page, nav and all. This is the floor beneath
 * that, not a replacement for it.
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
 * ## Status code
 *
 * Next emits a real 404 for this boundary, which is what `x-matched-path:
 * /[host]/[[...slug]]` returning `HTTP/2 404` on `https://aglyn.com/edit-access`
 * already showed — the status was never the defect. The BODY was: with no
 * boundary registered, that 404 carried Next's own unstyled page. Note this
 * differs from the DESIGNATED-screen path, which serves 200 + `noindex`
 * because ISR cannot emit a 404 status for dynamically composed content.
 */
export default function HostNotFound() {
  return (
    <SiteStatusScreen
      code="404"
      title={'We can’t find that page'}
      message={
        'The link may be out of date, or the page may have been moved or ' +
        'removed. Everything else on the site is still here.'
      }
    />
  )
}
