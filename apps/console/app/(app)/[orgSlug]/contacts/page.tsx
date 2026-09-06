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

import { permanentRedirect } from 'next/navigation'
import { buildRoute, Route } from '../../../../constants/route-links'

/**
 * The organization's address book, which is now a section of the
 * organization-level CRM (AGL-2630).
 *
 * This address held a deliberately read-only, cross-site address book: one
 * deduplicated row per person, which sites know them, and their consent per
 * site. That page was right that a SCOPED collaborator must never read
 * across the host boundary — the gate it stood behind is the one the CRM hub
 * stands behind now — and it was overruled on what an ORG-WIDE member may do
 * there: the same CRM the site hub offers, every section of it, over every
 * site at once. The cross-site facts it showed moved with it, onto the
 * contacts section's "Known by" column and the record's card.
 *
 * Permanent, so a link kept from before — a bookmark, a docs page, an email
 * — is corrected by the browser rather than followed twice; the constant is
 * kept so nothing builds this address by hand. A server redirect rather
 * than a client one because there is no decision to make: the destination
 * is the same for every reader, and a reader the hub refuses is refused
 * there, with the reason.
 */
export default async function OrgContactsRedirect({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  permanentRedirect(`${buildRoute(Route.ORG_CRM, { orgSlug })}/contacts`)
}
