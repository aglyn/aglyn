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
 * A staff alert by email, from LIBRARY code (AGL-2925).
 *
 * `STAFF_ALERT_EMAIL` is the one inbox every subsystem's alert lands in —
 * the console's `emailStaffAlert` in `apps/console/app/api/_lib/
 * usage-alert-email.ts` sends the cron's alerts there. The AI doors cannot
 * call that: `/api/ai/assist` lives in a plugin library and the meter they
 * share lives here, and a library cannot import from an app. So the meter's
 * own alert — the platform-wide free-spend ceiling — sends through this,
 * to the same address, with the same posture: unset is the ordinary answer
 * outside production and reports `unconfigured`, and nothing here throws,
 * because the mail is a courtesy and the refusal it announces is the
 * control.
 *
 * Platform email metering is loaded lazily and only after a send, so that
 * importing this module — which every unit test of the meter does — never
 * pulls the Firestore-backed meter, and with it the admin app, into a test
 * that only wanted to count credits.
 */
export async function sendStaffAlertEmail(input: {
  subject: string
  text: string
  /** Resend tag / log label. */
  context: string
}): Promise<SendEmailResult> {
  const to = String(process.env.STAFF_ALERT_EMAIL ?? '').trim()
  if (!to.includes('@')) return { sent: false, reason: 'unconfigured' }
  try {
    const result = await sendEmail({
      to,
      subject: input.subject,
      text: input.text,
      context: input.context,
    })
    if (result.sent) {
      // Platform-scoped (AGL-1438): our own alert is our own cost.
      const { meterPlatformEmail } = await import('./email-metering')
      await meterPlatformEmail().catch(() => undefined)
    }
    return result
  } catch (error) {
    console.error('[staff-alert-email] send failed', error)
    return { sent: false, reason: 'network' }
  }
}
