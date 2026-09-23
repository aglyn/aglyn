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

import { hostScopeToken, scopeTokensForHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  orgCampaignSendsPath,
  orgCampaignSequenceReportsPath,
  orgEmailCampaignsPath,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-container'
import {
  collection,
  doc,
  query,
  where,
  type DocumentReference,
  type Firestore,
  type Query,
} from 'firebase/firestore'

/**
 * WHERE A CAMPAIGN AND ITS SENDS ARE READ FROM, at either level of the hub.
 *
 * Both collections belong to the organization: containers at
 * `orgs/{orgId}/emailCampaigns`, sends at `orgs/{orgId}/campaigns`, each
 * send's rollups under it at `…/reports/{name}`. Spelled once here so no card
 * rebuilds a path from memory, and so the one rule that makes a site hub's
 * read legal is in one place:
 *
 * **A site hub's LIST reads are filtered by scope.** The rules let an
 * org-wide member read every document and a site collaborator only those
 * whose `visibleTo` names a scope they hold. A query the rules cannot prove
 * document by document is refused whole, so a site hub asks exactly for what
 * that site may see — a container placed on every site (`'org'`) or on this
 * one (`'host:{id}'`), and a send sent AS this site. An org-wide member loses
 * nothing by the filter at a site: those are the campaigns the site shows.
 *
 * The ORG hub is admitted only to org-wide members, so its reads are
 * unfiltered.
 *
 * One `array-contains-any` per query is Firestore's limit, so no caller adds
 * a second array clause to these; per-document reads need no filter at all.
 */

/**
 * `orgs/{orgId}/emailCampaigns`, narrowed to one site's placements when
 * `hostId` names a site; `null` until the org is known.
 */
export function campaignContainersQuery(
  firestore: Firestore,
  orgId: string | null,
  hostId: string | null,
): Query | null {
  if (!orgId) return null
  const containers = collection(firestore, ...orgEmailCampaignsPath(orgId))
  return hostId
    ? query(
        containers,
        where('visibleTo', 'array-contains-any', scopeTokensForHost(hostId)),
      )
    : containers
}

/**
 * `orgs/{orgId}/campaigns` — the sends — narrowed to the ones sent as one
 * site when `hostId` names a site; `null` until the org is known.
 */
export function campaignSendsQuery(
  firestore: Firestore,
  orgId: string | null,
  hostId: string | null,
): Query | null {
  if (!orgId) return null
  const sends = collection(firestore, ...orgCampaignSendsPath(orgId))
  return hostId
    ? query(
        sends,
        where('visibleTo', 'array-contains-any', [hostScopeToken(hostId)]),
      )
    : sends
}

/** One container, `orgs/{orgId}/emailCampaigns/{id}`. */
export function campaignContainerDoc(
  firestore: Firestore,
  orgId: string,
  campaignId: string,
): DocumentReference {
  return doc(firestore, ...orgEmailCampaignsPath(orgId), campaignId)
}

/** One send, `orgs/{orgId}/campaigns/{sendId}`. */
export function campaignSendDoc(
  firestore: Firestore,
  orgId: string,
  sendId: string,
): DocumentReference {
  return doc(firestore, ...orgCampaignSendsPath(orgId), sendId)
}

/** One of a send's rollups, `orgs/{orgId}/campaigns/{sendId}/reports/{name}`. */
export function campaignSendReportDoc(
  firestore: Firestore,
  orgId: string,
  sendId: string,
  report: 'links' | 'revenue' | 'conversions' | 'reached',
): DocumentReference {
  return doc(
    firestore,
    ...orgCampaignSendsPath(orgId),
    sendId,
    'reports',
    report,
  )
}

/** A container's sequence rollup, `orgs/{orgId}/campaignSequenceReports/{id}`. */
export function campaignSequenceReportDoc(
  firestore: Firestore,
  orgId: string,
  campaignId: string,
): DocumentReference {
  return doc(firestore, ...orgCampaignSequenceReportsPath(orgId), campaignId)
}
