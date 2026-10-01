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
  PluginConversionTouch,
} from '@aglyn/aglyn/plugin-manager/plugin-conversion-credit'
import { CAMPAIGN_CONVERSION_KINDS, type CampaignConversionKind } from '../model/campaign-conversions'
import {
  attributeCampaignConversion,
  creditCampaignSequenceOutcome,
  eraseCampaignAttributionsForPersonKey,
  resolveCampaignTouch,
  type CampaignSequenceOutcome,
  type CampaignTouchChannel,
  type ResolvedCampaignTouch,
} from './campaign-conversion-attribution'
import { eraseEmailCampaignTouches, recordEmailCampaignTouch } from './email-campaign-touch'
import { attributeOrderToEmail, reverseEmailAttributedRevenue } from './email-revenue-attribution'

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

const CHANNELS: readonly CampaignTouchChannel[] = ['email', 'web', 'sequence']

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
}
