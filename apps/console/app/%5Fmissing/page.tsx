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

import type { Metadata } from 'next'
import MissingAddressScreen from '../../components/missing-address.component'

/**
 * The console's not-found page at an address of its own (AGL-3290).
 *
 * The middleware answers an address that names no workspace with a 404 whose
 * body forwards the browser here — through `/signin?continue=…` first when the
 * request carried no session. It has to be a real route rather than the
 * address the visitor typed: that address is refused by the same middleware
 * every time it is asked for, so a `continue` pointing back at it would bounce
 * between the refusal and the sign-in page forever. This one is always served.
 *
 * `?from=` carries the address that was not found. The screen puts it back in
 * the address bar once the visitor is signed in, so what they see there is
 * what they asked for.
 *
 * The folder is `%5Fmissing` so the URL segment is `_missing`. No workspace
 * slug can begin with `_` (`ORG_SLUG_PATTERN`), so the route can never shadow
 * a workspace, and `isConsoleRouteSegment` admits it without a verdict lookup.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
}

export default function MissingPage() {
  return <MissingAddressScreen />
}
