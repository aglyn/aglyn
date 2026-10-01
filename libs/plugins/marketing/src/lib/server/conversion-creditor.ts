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

import type {
  PluginConversionClick,
  PluginConversionCreditor,
  PluginConversionDescription,
  PluginConversionTouch,
} from '@aglyn/aglyn/plugin-manager/plugin-conversion-credit'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { CAMPAIGN_SEND_CONTAINER_FIELD } from '@aglyn/shared-ui-email-campaigns/model/campaign-container'
import { CAMPAIGN_CONVERSION_KINDS, type CampaignConversionKind } from '../model/campaign-conversions'
import {
  attributeCampaignConversion,
  creditCampaignSequenceOutcome,
  eraseCampaignAttributionsForPersonKey,
  resolveCampaignSendRef,
  resolveCampaignTouch,
  type CampaignSequenceOutcome,
  type CampaignTouchChannel,
  type ResolvedCampaignTouch,
} from './campaign-conversion-attribution'
import { eraseEmailCampaignTouches, recordEmailCampaignTouch } from './email-campaign-touch'
import { attributeOrderToEmail, reverseEmailAttributedRevenue } from './email-revenue-attribution'
import { readLiveCampaign } from './campaign-touch-targets'

/**
 * The Marketing plugin's conversion creditor: the platform's
 * `plugin-conversion-credit` contract, answered by the campaign joins this
 * plugin keeps.
 *
 *  - a door's identify moment (a form, a lead, a contact, a booking) by the
 *    last-touch join (`campaign-conversion-attribution.ts`);
 *  - an order's money and its refund by the revenue join
 *    (`email-revenue-attribution.ts`);
 *  - a click on mail another plugin sent by the touch map
 *    (`email-campaign-touch.ts`), which a sequence's mail stamps with its
 *    sequence and enrollment;
 *  - what a sequence produced, counted under the campaigns it is filed in;
 *  - and the person's erasure, which takes the touches and every credit
 *    drawn from them.
 *
 * A touch leaves here as the join resolved it and comes back from the door
 * unread, so a value is checked for the shape the join writes before it is
 * credited: a door that handed something else hands nobody's credit.
 *
 * Loaded with the first credit, never at boot; every writer it reaches
 * already never throws.
 */

const CHANNELS: readonly CampaignTouchChannel[] = ['email', 'web', 'sequence', 'page']

/** A touch as this plugin resolved it, or `null` for anything else. */
function asResolvedTouch(value: PluginConversionTouch | null | undefined): ResolvedCampaignTouch | null {
  if (!value || typeof value !== 'object') return null
  const channel = value['channel']
  const touchedAtMs = value['touchedAtMs']
  if (!CHANNELS.includes(channel as CampaignTouchChannel)) return null
  if (typeof touchedAtMs !== 'number' || !Number.isFinite(touchedAtMs)) return null
  return value as unknown as ResolvedCampaignTouch
}

/** The touch a click on this or another plugin's mail is credited as. */
function touchOfClick(click: PluginConversionClick): ResolvedCampaignTouch {
  const sequenceId = click.via?.['sequenceId']
  const enrollmentId = click.via?.['enrollmentId']
  const viaSequence = Boolean(sequenceId && enrollmentId)
  return {
    channel: viaSequence ? 'sequence' : 'email',
    campaignId: click.creditTo,
    ...(viaSequence ? { sequenceId, enrollmentId } : {}),
    touchedAtMs: click.atMs,
  }
}

const isConversionKind = (kind: string): kind is CampaignConversionKind =>
  (CAMPAIGN_CONVERSION_KINDS as readonly string[]).includes(kind)

/** How many of a record's containers an alert names. */
const DESCRIBE_CONTAINERS_MAX = 5

/** How a touch reached the visitor, in the phrase an alert prints. */
function howTouched(touch: ResolvedCampaignTouch): string {
  switch (touch.channel) {
    case 'page':
      return touch.path ? `viewed ${touch.path}, a page filed under it` : 'viewed a page filed under it'
    case 'email':
      return 'clicked one of its emails'
    case 'sequence':
      return 'clicked a sequence email in it'
    default:
      return touch.campaign ? `followed a link labeled ${touch.campaign}` : 'followed a labeled link'
  }
}

/**
 * The campaign a touch names, by name: the container it carries, or — for a
 * click on a campaign's mail, which carries the SEND — the container that
 * send is in, else the send's subject.
 */
async function creditedCampaignName(
  hostId: string,
  orgId: string | null,
  touch: ResolvedCampaignTouch,
): Promise<{ label: string; containerId?: string } | null> {
  const campaignId = String(touch.campaignId ?? '')
  if (!campaignId) return null
  if (touch.channel !== 'email') {
    if (!orgId) return null
    const campaign = await readLiveCampaign({ orgId, campaignId }, firebaseAdmin.app().firestore())
    return campaign ? { label: campaign.name, containerId: campaign.id } : null
  }
  const sendRef = await resolveCampaignSendRef({ hostId, sendId: campaignId, orgId })
  const send = sendRef ? ((await sendRef.get()).data() ?? {}) : {}
  const containerId = String(send[CAMPAIGN_SEND_CONTAINER_FIELD] ?? '')
  if (containerId && orgId) {
    const campaign = await readLiveCampaign(
      { orgId, campaignId: containerId },
      firebaseAdmin.app().firestore(),
    )
    if (campaign) return { label: campaign.name, containerId: campaign.id }
  }
  const subject = String(send['subject'] ?? '').trim()
  return subject ? { label: subject } : null
}

export const marketingConversionCreditor: PluginConversionCreditor = {
  async resolveTouch(request) {
    const touch = await resolveCampaignTouch(request)
    return touch ? ({ ...touch } as PluginConversionTouch) : null
  },

  async creditConversion(request) {
    if (!isConversionKind(request.kind)) return false
    const touch = request.click ? touchOfClick(request.click) : asResolvedTouch(request.touch)
    if (!touch) return false
    const record = await attributeCampaignConversion({
      hostId: request.hostId,
      kind: request.kind,
      refId: request.refId,
      touch,
      ...(request.convertedAtMs !== undefined ? { convertedAtMs: request.convertedAtMs } : {}),
    })
    return record !== null
  },

  async creditOrder(request) {
    return (await attributeOrderToEmail(request)) !== null
  },

  async reverseOrder(request) {
    return reverseEmailAttributedRevenue(request)
  },

  async recordClick(click) {
    const sequenceId = click.via?.['sequenceId']
    const enrollmentId = click.via?.['enrollmentId']
    return recordEmailCampaignTouch({
      email: typeof click.email === 'string' ? click.email : String(click.email ?? ''),
      hostId: click.hostId,
      campaignId: click.creditTo,
      atMs: click.atMs,
      ...(sequenceId && enrollmentId ? { sequenceId, enrollmentId } : {}),
    })
  },

  async creditOutcome(request) {
    return creditCampaignSequenceOutcome({
      hostId: request.hostId,
      ...(request.orgId ? { orgId: request.orgId } : {}),
      campaignIds: request.containerIds,
      outcome: request.outcome as CampaignSequenceOutcome,
      ...(request.atMs !== undefined ? { atMs: request.atMs } : {}),
    })
  },

  async erasePerson(key) {
    const touches = await eraseEmailCampaignTouches(key)
    const credits = await eraseCampaignAttributionsForPersonKey(key)
    return credits + (touches ? 1 : 0)
  },

  async describeConversion(request) {
    try {
      const touch = asResolvedTouch(request.touch)
      const ids = [...new Set((request.containerIds ?? []).map((id) => String(id ?? '').trim()))]
        .filter(Boolean)
        .slice(0, DESCRIBE_CONTAINERS_MAX)
      if (!touch && !ids.length) return null
      const orgId = await resolveOrgIdForHost(request.hostId).catch(() => null)
      const db = firebaseAdmin.app().firestore()
      const filedUnder: PluginConversionDescription['filedUnder'] = []
      if (orgId) {
        for (const campaignId of ids) {
          const campaign = await readLiveCampaign({ orgId, campaignId }, db)
          if (campaign) filedUnder.push({ id: campaign.id, label: campaign.name })
        }
      }
      let credited: PluginConversionDescription['credited']
      if (touch) {
        const named = await creditedCampaignName(request.hostId, orgId, touch)
        const label =
          named?.label ??
          (touch.channel === 'web'
            ? [touch.source, touch.medium, touch.campaign].filter(Boolean).join(' / ')
            : '')
        if (label) {
          credited = {
            label,
            how: howTouched(touch),
            ...(named?.containerId ? { containerId: named.containerId } : {}),
          }
        }
      }
      return { ...(credited ? { credited } : {}), filedUnder }
    } catch (error) {
      console.error('[conversion-credit] describe failed', error)
      return null
    }
  },
}
