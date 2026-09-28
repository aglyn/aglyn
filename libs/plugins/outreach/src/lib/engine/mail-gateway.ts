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

/*==========================================
 * THE MAIL GATEWAY, AS SEQUENCES NAMES IT (AGL-3326).
 *
 * The engine is the platform's — `@aglyn/shared-util-email`'s
 * `mail-gateway` (AGL-3328), which the Resend path reads too, so one table
 * names a gateway and one rule holds a send for both. What stays here is
 * the vocabulary Sequences already speaks, and the one sentence it adds: a
 * held enrollment is resumed by a member.
 *
 * ## The hold, as Sequences applies it
 *
 * A gateway that REFUSED the mailbox's sending domain twice in the last
 * {@link OUTREACH_GATEWAY_WINDOW_DAYS} days without delivering once holds
 * the next send into it: nothing goes into a gateway that has refused us
 * twice unless a member says so. `other` never holds; `none` blocks instead.
 *==========================================*/

import {
  classifyMailGateway,
  isMailGatewayFronted,
  MAIL_DOMAIN_INTEL_TTL_MS,
  MAIL_GATEWAY_CHIP_DAYS,
  MAIL_GATEWAY_DELIVERED_AFTER_MS,
  MAIL_GATEWAY_HOLD_BLOCKS,
  MAIL_GATEWAY_LABELS,
  MAIL_GATEWAY_WINDOW_DAYS,
  MAIL_GATEWAYS,
  MAIL_GATEWAYS_FRONTED,
  type MailGateway,
  mailGatewayChip,
  type MailGatewayChip,
  type MailGatewayChipTone,
  mailGatewayDay,
  type MailGatewayDayCounts,
  mailGatewayHolds,
  mailGatewayHoldSentence,
  mailGatewayOfHost,
  type MailGatewayStanding,
  mailGatewayWindow,
  pruneMailGatewayDays,
} from '@aglyn/shared-util-email/mail-gateway'

export type OutreachMailGateway = MailGateway
export type OutreachGatewayDayCounts = MailGatewayDayCounts
export type OutreachGatewayStanding = MailGatewayStanding
export type OutreachGatewayChipTone = MailGatewayChipTone
export type OutreachGatewayChip = MailGatewayChip

export const OUTREACH_MAIL_GATEWAYS = MAIL_GATEWAYS
/** The gateway as the Check-people chip and the enrollment row name it. */
export const OUTREACH_MAIL_GATEWAY_LABELS = MAIL_GATEWAY_LABELS
/** The security gateways the enroll dialog counts as "gateway-fronted". */
export const OUTREACH_GATEWAY_FRONTED = MAIL_GATEWAYS_FRONTED
export const OUTREACH_GATEWAY_HOLD_BLOCKS = MAIL_GATEWAY_HOLD_BLOCKS
export const OUTREACH_GATEWAY_WINDOW_DAYS = MAIL_GATEWAY_WINDOW_DAYS
export const OUTREACH_GATEWAY_CHIP_DAYS = MAIL_GATEWAY_CHIP_DAYS
export const OUTREACH_DOMAIN_INTEL_TTL_MS = MAIL_DOMAIN_INTEL_TTL_MS
export const OUTREACH_GATEWAY_DELIVERED_AFTER_MS = MAIL_GATEWAY_DELIVERED_AFTER_MS

export const outreachMailGatewayOfHost = mailGatewayOfHost
export const classifyOutreachMailGateway = classifyMailGateway
export const isOutreachGatewayFronted = isMailGatewayFronted
export const outreachGatewayDay = mailGatewayDay
export const outreachGatewayWindow = mailGatewayWindow
export const pruneOutreachGatewayDays = pruneMailGatewayDays
export const outreachGatewayHolds = mailGatewayHolds
export const outreachGatewayChip = mailGatewayChip

/** The sentence the hold is written with, on the enrollment and in the engine's reason. */
export function outreachGatewayHoldReason(gateway: OutreachMailGateway, blocked30: number): string {
  return `${mailGatewayHoldSentence(gateway, blocked30)}, so this email is held. Resume the enrollment to send it anyway.`
}
