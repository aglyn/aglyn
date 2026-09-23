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
 * WHERE THIS PLUGIN'S SERVER CODE FINDS A CAMPAIGN, AND WHICH SITE A SEND IS.
 *
 * Containers and sends belong to the organization —
 * `orgs/{orgId}/emailCampaigns` and `orgs/{orgId}/campaigns` — while every
 * request that reaches this plugin arrives naming a SITE. The handlers know
 * the org (they resolve it to check the plan and the sender), so they address
 * the org collections directly; these helpers are the one spelling of those
 * paths on the Admin SDK, beside the segment tuples the console uses from
 * `campaign-container.ts`.
 *
 * ## Why a send is checked against the site that asks for it
 *
 * One org collection holds every site's sends, and a send id is not a secret:
 * it is in every unsubscribe link and every report URL. A handler that took a
 * site from the request and a send id from the request and acted on the pair
 * would let an editor of one site cancel, mail or discard a sibling site's
 * email by naming its id. So every door that addresses an existing send asks
 * {@link sendIsOnHost} first. A send with no stored site is one written before
 * sends recorded theirs; the migration stamps it, and until then it is
 * admitted rather than stranded.
 */

import {
  CAMPAIGN_SEND_HOST_FIELD,
  CAMPAIGN_SENDS_COLLECTION,
  EMAIL_CAMPAIGNS_COLLECTION,
  campaignSendVisibleTo,
} from '@aglyn/shared-ui-email-campaigns/model'

type Firestore = FirebaseFirestore.Firestore

function orgRef(
  firestore: Firestore,
  orgId: string,
): FirebaseFirestore.DocumentReference {
  /*
   * Refused outright, not left to `.doc()`: an empty id throws there, but a
   * `null` becomes the string `'null'` and addresses an org of that name —
   * and nothing here is checked by the compiler for it.
   */
  if (typeof orgId !== 'string' || !orgId) {
    throw new Error('[marketing] a campaign path needs an organization')
  }
  return firestore.collection('orgs').doc(orgId)
}

/** `orgs/{orgId}/campaigns` — one document per send. */
export function orgCampaignSends(
  firestore: Firestore,
  orgId: string,
): FirebaseFirestore.CollectionReference {
  return orgRef(firestore, orgId).collection(CAMPAIGN_SENDS_COLLECTION)
}

/** `orgs/{orgId}/emailCampaigns` — one document per campaign container. */
export function orgEmailCampaigns(
  firestore: Firestore,
  orgId: string,
): FirebaseFirestore.CollectionReference {
  return orgRef(firestore, orgId).collection(EMAIL_CAMPAIGNS_COLLECTION)
}

/**
 * The two fields every write that creates a send stamps: the site it is sent
 * as, and that one site's scope token.
 *
 * Merged onto existing sends too. It is the same value the send already
 * carries, or — on a send the migration has not reached — the value it is
 * missing.
 */
export function campaignSendSiteStamp(hostId: string): {
  hostId: string
  visibleTo: string[]
} {
  if (typeof hostId !== 'string' || !hostId) {
    throw new Error('[marketing] a send has to name the site it is sent as')
  }
  return {
    [CAMPAIGN_SEND_HOST_FIELD]: hostId,
    visibleTo: campaignSendVisibleTo(hostId),
  } as { hostId: string; visibleTo: string[] }
}

/**
 * Whether a stored send may be acted on in the name of this site. See the
 * header for why an absent site is admitted.
 */
export function sendIsOnHost(
  snapshot: { get(field: string): unknown },
  hostId: string,
): boolean {
  const stored = snapshot.get(CAMPAIGN_SEND_HOST_FIELD)
  if (stored === undefined || stored === null || stored === '') return true
  return stored === hostId
}

/** The site a stored send is sent as, or `''` when it records none. */
export function sendHostId(snapshot: { get(field: string): unknown }): string {
  const stored = snapshot.get(CAMPAIGN_SEND_HOST_FIELD)
  return typeof stored === 'string' ? stored : ''
}
