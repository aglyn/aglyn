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
 * EMAIL SENDS, NATIVELY (AGL-3622).
 *
 * The console's Emails list and one email's report, read the way the console
 * reads them: `orgs/{orgId}/campaigns` on the list declaration the console's
 * grid plans with (`campaignEmailsListQuery`, the site's `hostId ==` scope
 * beside it), and every write as one POST to the console's own
 * `/api/campaigns/send`, which decides everything. Nothing here decides
 * whether an email may be sent; it only offers the controls the console's
 * email page offers in the same state.
 */

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { searchWords, useLiveDoc, useMobileListQuery } from '@aglyn/mobile-core'
import type { MobileApiClient } from '@aglyn/mobile-plugin-host'
import type { SendLinkRollup, SendStats } from '@aglyn/shared-ui-email-campaigns/model/send-report'
import type { ListQueryRequest } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  campaignSendDisplay,
  orgCampaignSendsPath,
  type CampaignSend,
  type CampaignSendDisplay,
} from '../lib/model/campaign-container'
import {
  CAMPAIGN_SEND_STATUS_OPTIONS,
  campaignEmailsListQuery,
  campaignSendsScope,
} from '../lib/model/campaign-list-query'

/** One send as the lists read it: `{ $id, ...data }`. */
export type CampaignSendRecord = CampaignSend &
  Record<string, unknown> & { $id: string; stats?: SendStats }

/** The console's own route for every action on a send. */
export const CAMPAIGN_SEND_ROUTE = '/api/campaigns/send'

/** "All" plus the stored statuses the console's Status filter offers. */
export const CAMPAIGN_STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  ...CAMPAIGN_SEND_STATUS_OPTIONS,
]

/**
 * The list's request: the Status clause, the search words, and the site's
 * scope. On the workspace (no site) the scope is empty, which only an
 * org-wide member's read is admitted for — the console's org Emails page.
 */
export function campaignSendsRequest(
  hostId: string | null,
  status: string,
  search: string,
): ListQueryRequest {
  return {
    clauses: status && status !== 'all' ? [{ field: 'status', op: 'equals', value: status }] : [],
    search: searchWords(search),
    base: campaignSendsScope(hostId),
  }
}

export function useCampaignSends(options: {
  firestore: unknown
  orgId: string | null
  hostId: string | null
  status: string
  search: string
  enabled?: boolean
}) {
  const { firestore, orgId, hostId, status, search, enabled = true } = options
  return useMobileListQuery<CampaignSendRecord>({
    firestore,
    path: orgId ? orgCampaignSendsPath(orgId) : null,
    declaration: campaignEmailsListQuery(!hostId),
    request: campaignSendsRequest(hostId, status, search),
    normalizers: nameSearchNormalizers,
    enabled,
  })
}

/** One send and its link rollup, live — the two documents the console's report reads. */
export function useCampaignSend(firestore: unknown, orgId: string | null, sendId: string | null) {
  const send = useLiveDoc<CampaignSendRecord>(
    firestore,
    orgId && sendId ? [...orgCampaignSendsPath(orgId), sendId] : null,
  )
  const links = useLiveDoc<SendLinkRollup>(
    firestore,
    orgId && sendId && send.data ? [...orgCampaignSendsPath(orgId), sendId, 'reports', 'links'] : null,
  )
  return { send, links }
}

/**
 * Whether the reader may act on a send as its site: the route's own test,
 * `memberRoles[uid]` of `admin` or `editor` on `hosts/{hostId}`. The route
 * refuses everyone else, so the app does not offer them a button.
 */
export function useSiteSendRole(firestore: unknown, hostId: string | null, uid: string | null) {
  const host = useLiveDoc<{ memberRoles?: Record<string, string> }>(firestore, hostId ? ['hosts', hostId] : null)
  const role = uid ? host.data?.memberRoles?.[uid] : undefined
  return { ready: host.ready || !hostId, canSend: role === 'admin' || role === 'editor' }
}

/**
 * Which of the console email page's controls apply to this send, decided
 * exactly as `email-detail.tsx` decides them.
 */
export interface CampaignSendControls {
  display: CampaignSendDisplay
  /** Draft or scheduled and not mid-flight or held: "Send now". */
  sendNow: boolean
  /** Between batches: the primary act is "Stop sending". */
  stop: boolean
  /** Sent: "Send to more recipients". */
  followUp: boolean
  /** Scheduled and not mid-flight: "Cancel send" (a held send keeps it). */
  cancel: boolean
  /** The composer is open to it, so a test may be sent and it may be written. */
  compose: boolean
}

export function campaignSendControls(send: CampaignSendRecord | null | undefined): CampaignSendControls {
  const display = campaignSendDisplay(send as CampaignSend)
  const state = String(send?.status ?? '')
  const draft = state === 'draft'
  const scheduled = state === 'scheduled'
  const midFlight = display.state === 'sending'
  const held = display.state === 'held'
  return {
    display,
    sendNow: !held && (draft || scheduled) && !midFlight,
    stop: !held && midFlight,
    followUp: !held && state === 'sent',
    cancel: scheduled && !midFlight,
    compose: (draft || scheduled) && !midFlight && !held,
  }
}

/**
 * The message a test mails, as the stored email holds it — the fields the
 * console's composer hands its test drawer, read off the record the composer
 * loads them from. A designed email sends no `body` and a plain one no
 * `plainText`, the route's one-source rule.
 */
export function testMessageFromRecord(send: CampaignSendRecord): Record<string, unknown> {
  const text = (key: string) => String(send[key] ?? '').trim()
  const templateScreenId = text('templateScreenId')
  const message: Record<string, unknown> = {
    subject: text('subject') || 'Test send',
    body: templateScreenId ? '' : String(send['body'] ?? ''),
    fromName: text('fromName'),
    replyTo: text('replyTo'),
    preheader: text('preheader'),
  }
  if (text('senderId')) message['senderId'] = text('senderId')
  if (templateScreenId) message['templateScreenId'] = templateScreenId
  if (templateScreenId && String(send['plainText'] ?? '')) message['plainText'] = String(send['plainText'])
  if (text('emailCampaignId')) message['emailCampaignId'] = text('emailCampaignId')
  return message
}

/**
 * One POST to the send route, naming the site the send is sent as — the
 * console's `useCampaignSendApi`, whose body is the payload plus `hostId`.
 * The route answers with no idempotency key; it refuses a repeat on the
 * record's own state instead (`sendNow` claims the email in a transaction).
 */
export function postCampaignSend<T = Record<string, unknown>>(
  api: MobileApiClient,
  hostId: string,
  payload: Record<string, unknown>,
): Promise<T> {
  return api.request<T>(CAMPAIGN_SEND_ROUTE, { method: 'POST', body: { ...payload, hostId } })
}

/** The route's own refusal, or the console's fallback line for the action. */
export function refusalOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const people = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'person' : 'people'}`

/** The confirmations, word for word the console's. */
export function sendNowConfirmation(reaching: number, scheduled: boolean) {
  return {
    title: 'Send this email now?',
    message:
      `This sends it to ${people(reaching)} straight away` +
      (scheduled ? ', instead of at the time it is scheduled for. ' : '. ') +
      'It cannot be taken back once it goes.',
    confirm: 'Send now',
  }
}

export function followUpConfirmation(reaching: number, already: number) {
  return {
    title: 'Send this email to more people?',
    message:
      `This sends the same email to ${reaching.toLocaleString()} more ` +
      `${reaching === 1 ? 'person' : 'people'} in the same audience. ` +
      `The ${already.toLocaleString()} who already received it are not ` +
      'sent it again, and its report adds the new figures to the ones ' +
      'it already holds.',
    confirm: 'Send',
  }
}

export function cancelConfirmation(midFlight: boolean, reached: number, left: number) {
  return midFlight
    ? {
        title: 'Stop sending this email?',
        message:
          `It has reached ${people(reached)} so far, and stopping it ` +
          `leaves ${left.toLocaleString()} unaddressed. What has already ` +
          'gone out cannot be taken back — those messages stay in inboxes ' +
          'and keep their unsubscribe links. The email and its report are ' +
          'kept, but a stopped send cannot be resumed; reaching the rest ' +
          'means composing a new email.',
        confirm: 'Stop sending',
      }
    : {
        title: 'Cancel this scheduled email?',
        message:
          'It will not be sent at the time it is scheduled for. The email ' +
          'and everything written on it are kept, but a canceled email ' +
          'cannot be put back on the schedule — you would compose a new one.',
        confirm: 'Cancel send',
      }
}

/** A percentage to one decimal place, as the console's rate rows print it. */
export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
