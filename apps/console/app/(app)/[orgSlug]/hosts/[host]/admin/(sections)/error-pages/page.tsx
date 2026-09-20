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

'use client'

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import ErrorScreensCard from '../../../../../../../../components/error-screens-card.component'
import { useHostId } from '../../../../../../../../components/host-id-provider'

/**
 * The screen behind each status code, and the switch that shows the 503 one at
 * every address at once (AGL-3178).
 *
 * ## Why it is here and not on Setup
 *
 * Both writes on this card are site-wide. `errorScreens` designates what a
 * visitor is handed at an address the site does not serve, and `maintenance`
 * replaces EVERY page for EVERY visitor — an act at least as consequential as
 * deleting one screen, which moved to the Danger zone for the same reason
 * (AGL-1014). Setup is a page a collaborator visits to change a logo or a
 * phone number; a switch that takes the whole site dark does not belong beside
 * them.
 *
 * ## Why its own section rather than a card under General
 *
 * General is the site as an OBJECT — its display name and the subdomain it
 * answers to, one card behind one save handler. Nothing here is a fact about
 * the site's identity: these are controls over what visitors see, so folding
 * them into that card's section would file them under a heading that does not
 * describe them. The rail puts this next to Security instead, where the
 * neighboring question — what a visitor's browser is handed, and what it is
 * allowed to do with it — is the same one.
 *
 * ## Where the capability is enforced
 *
 * The `admin/(sections)` layout above this page renders its children only for
 * `useIsHostAdmin()`, so the section URL refuses a non-admin rather than
 * merely going missing from the rail. That is a notice, not the boundary: the
 * `errorScreens` write goes through `/api/hosts/screens`, which admits only
 * the host writer roles, and `maintenance` is a client write the Firestore
 * rules govern.
 */
const HostAdminErrorPages: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  return <ErrorScreensCard hostId={hostId} />
}
HostAdminErrorPages.displayName = 'Page:HostAdminErrorPages'

export default HostAdminErrorPages
