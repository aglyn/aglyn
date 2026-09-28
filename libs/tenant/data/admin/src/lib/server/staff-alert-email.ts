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

import { sendEmail, type SendEmailResult } from '@aglyn/shared-util-email'

/**
 * Staff alerts by email, from LIBRARY code (AGL-2925).
 *
 * One destination for every subsystem's alarm — the console's
 * `emailStaffAlert` in `apps/console/app/api/_lib/usage-alert-email.ts` sends
 * through here too — resolved by {@link resolveStaffAlertRecipients}
 * (AGL-3375). Nothing here throws, because the mail is a courtesy and the
 * refusal it announces is the control; with no address anywhere the answer
 * is `unconfigured`.
 *
 * Platform email metering is loaded lazily and only after a send, so that
 * importing this module — which every unit test of the meter does — never
 * pulls the Firestore-backed meter, and with it the admin app, into a test
 * that only wanted to count credits. The system-email renderer and the staff
 * roster, which read through the same admin app, are loaded the same way.
 */

/** At most this many staff accounts are mailed when no inbox is configured. */
const STAFF_FALLBACK_MAX = 10

/**
 * Where a staff alarm goes (AGL-3375), first answer wins:
 *
 * 1. `STAFF_ALERT_EMAIL`, the operator's one alerts inbox.
 * 2. The operator's published support address,
 *    `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL`, which every self-hosted install is
 *    asked for and most set.
 * 3. Every staff account's own address, up to {@link STAFF_FALLBACK_MAX}.
 *
 * Only the first applies on a preview or development deployment.
 *
 * The chain exists because the alarms that matter most are the ones an
 * install nobody tuned would otherwise send to no one: card testing on its
 * checkout, a stolen card on its first subscription, a phishing campaign
 * held on its sending domain. An unset variable used to mean silence.
 *
 * Empty only when none of the three yields an address.
 */
export async function resolveStaffAlertRecipients(): Promise<string[]> {
  const configured = String(process.env.STAFF_ALERT_EMAIL ?? '').trim().toLowerCase()
  if (configured.includes('@')) return [configured]
  // A preview or development deployment says what it is; only a production
  // one, or a self-hosted install that sets no such thing, falls back. A
  // preview's alarms reaching the operator's real inbox would be noise.
  const deployment = String(process.env.VERCEL_ENV ?? '').trim()
  if (deployment && deployment !== 'production') return []
  const operator = String(process.env.NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL ?? '')
    .trim()
    .toLowerCase()
  if (operator.includes('@')) return [operator]
  try {
    const { findUserByUidAcrossPools, listStaffUidsAcrossPools } = await import(
      './auth-pools'
    )
    const uids = (await listStaffUidsAcrossPools()).slice(0, STAFF_FALLBACK_MAX)
    const addresses = new Set<string>()
    for (const uid of uids) {
      const pooled = await findUserByUidAcrossPools(uid).catch(() => null)
      const address = String(pooled?.record?.email ?? '').trim().toLowerCase()
      if (address.includes('@')) addresses.add(address)
    }
    return [...addresses]
  } catch (error) {
    console.error('[staff-alert-email] staff roster unavailable', error)
    return []
  }
}

/**
 * Sends one rendered alert to each operator recipient, one message each so
 * no staff member is shown another's address. Metered to the platform: our
 * own alarm is our own cost (AGL-1438). Never throws.
 */
async function sendToOperators(
  content: { subject: string; text: string; html?: string },
  context: string,
): Promise<SendEmailResult> {
  const recipients = await resolveStaffAlertRecipients()
  if (!recipients.length) return { sent: false, reason: 'unconfigured' }
  let delivered: SendEmailResult | null = null
  let failure: SendEmailResult = { sent: false, reason: 'unconfigured' }
  let sent = 0
  for (const to of recipients) {
    const result = await sendEmail({ to, ...content, context })
    if (result.sent) {
      sent += 1
      delivered ??= result
    } else {
      failure = result
    }
  }
  if (sent) {
    const { meterPlatformEmail } = await import('./email-metering')
    await meterPlatformEmail(sent).catch(() => undefined)
  }
  // Delivered to anyone is delivered: one dead staff mailbox does not make
  // the alert a failure for the caller.
  return delivered ?? failure
}

export async function sendStaffAlertEmail(input: {
  subject: string
  text: string
  /** Resend tag / log label. */
  context: string
}): Promise<SendEmailResult> {
  try {
    // In the platform's header and footer, as the `staff-alert` system email
    // (AGL-3367). Loaded lazily for the reason the meter is.
    const { renderSystemEmailContent, systemEmailBrand } = await import(
      './render-system-email'
    )
    const content = await renderSystemEmailContent(
      'staff-alert',
      { 'alert.subject': input.subject, 'alert.body': input.text },
      systemEmailBrand(null),
      { subject: input.subject, text: input.text },
    )
    return await sendToOperators(content, input.context)
  } catch (error) {
    console.error('[staff-alert-email] send failed', error)
    return { sent: false, reason: 'network' }
  }
}

/**
 * One operator alert (AGL-3375, AGL-3377), as the `operator-alert` system
 * email: the alert, a button to the item it is about, in the operator's own
 * brand. Sent by `raiseOperatorAlert` for every alert delivered immediately;
 * nothing else should call it. Never throws.
 */
export async function sendOperatorAlertEmail(input: {
  title: string
  body?: string | null
  /** Absolute link to the item, when there is one. */
  url?: string | null
  context: string
}): Promise<SendEmailResult> {
  try {
    const { renderSystemEmailContent, systemEmailBrand } = await import(
      './render-system-email'
    )
    const body = String(input.body ?? '').trim()
    const url = String(input.url ?? '').trim()
    const content = await renderSystemEmailContent(
      'operator-alert',
      { 'alert.title': input.title, 'alert.body': body, 'alert.url': url },
      systemEmailBrand(null),
      { subject: input.title, text: [input.title, body, url].filter(Boolean).join('\n\n') },
    )
    return await sendToOperators(content, input.context)
  } catch (error) {
    console.error('[staff-alert-email] operator alert failed', error)
    return { sent: false, reason: 'network' }
  }
}

/**
 * The day's batched operator alerts (AGL-3377), as the
 * `operator-alert-digest` system email. Sent by `sendOperatorAlertDigest`.
 * Never throws.
 */
export async function sendOperatorAlertDigestEmail(input: {
  /** The UTC day, `YYYY-MM-DD`. */
  date: string
  count: number
  /** The alerts, composed as one block of text. */
  body: string
  /** Absolute link to the staff console, when there is one. */
  url?: string | null
}): Promise<SendEmailResult> {
  try {
    const { renderSystemEmailContent, systemEmailBrand } = await import(
      './render-system-email'
    )
    const subject = `${input.count} operator alert${input.count === 1 ? '' : 's'} on ${input.date}`
    const url = String(input.url ?? '').trim()
    const content = await renderSystemEmailContent(
      'operator-alert-digest',
      {
        'digest.date': input.date,
        'digest.count': String(input.count),
        'digest.body': input.body,
        'digest.url': url,
      },
      systemEmailBrand(null),
      { subject, text: [subject, input.body, url].filter(Boolean).join('\n\n') },
    )
    return await sendToOperators(content, 'operator-alert-digest')
  } catch (error) {
    console.error('[staff-alert-email] operator digest failed', error)
    return { sent: false, reason: 'network' }
  }
}
