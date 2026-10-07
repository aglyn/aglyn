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

/** The plugin id, as `plugins.config.json` names it. */
export const SMS_PLUGIN_ID = 'sms'

/** Env the Twilio adapter reads. All three are required; none is public. */
export const TWILIO_ENV = {
  accountSid: 'TWILIO_ACCOUNT_SID',
  authToken: 'TWILIO_AUTH_TOKEN',
  messagingServiceSid: 'TWILIO_MESSAGING_SERVICE_SID',
} as const

/**
 * What one text segment costs Aglyn, in USD: Twilio's published US
 * long-code price per outbound segment ($0.0083) plus the typical US carrier
 * pass-through fee (~$0.003). Recorded per send in micro-dollars so a month's
 * cost sums exactly; the provider's own invoice is the authority and this is
 * the estimate the workspace is billed at until a provider reports a price.
 */
export const SMS_COST_PER_SEGMENT_USD = 0.0113

/**
 * Markup over cost on texts a workspace sends (AGL-3610). ZERO: texts are
 * billed at cost. Raising it is a pricing decision, Zach's, and it changes
 * what the docs may say about text pricing.
 */
export const SMS_MARKUP = 0

/** The usage meter id `usageAxes` declares and the sweep calls. */
export const SMS_USAGE_METER_ID = 'sms-texts'

/** `orgs/{orgId}/smsUsage/{YYYY-MM}`: one month's texts and their cost. */
export const SMS_USAGE_COLLECTION = 'smsUsage'

/**
 * Per-workspace send ceiling: texts per rolling hour. A transactional text
 * is owed by an order, so the ceiling is generous; it exists to stop a loop
 * or a compromised account turning a store into a text cannon at our cost.
 */
export const SMS_SENDS_PER_HOUR_PER_ORG = 300

/** Longest body we send: three GSM segments. Longer is truncated. */
export const SMS_MAX_BODY_CHARS = 459
