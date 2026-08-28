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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import { sendEmail, type SendEmailResult } from '@aglyn/shared-util-email'
import { meterPlatformEmail } from '@aglyn/tenant-data-admin'
import {
  newDeviceAlertSuppression,
  type KnownDevice,
  type SuppressionVerdict,
} from './device-alert-suppression'
import { renderSystemEmail } from './render-system-email'

/**
 * Security alert emails (AGL-665): new-device sign-in, and new passkey added.
 *
 * Device recognition is deliberately the simplest server-side model that is
 * real: a long-lived HttpOnly cookie (`aglyn_device`) minted by the session
 * route, backed by a per-user `users/{uid}/devices/{deviceId}` record. A
 * sign-in whose device id has no record under this uid is a new device. No
 * fingerprinting — a cleared cookie or a private window reads as a new
 * device, which is the documented tradeoff (the alternative, matching on
 * user-agent, lets a real attacker on the same browser string stay silent).
 *
 * Noise control: the very FIRST device recorded for a user never alerts.
 * That first record is either account creation or the rollout backfill of an
 * existing account, and "new device" mail on either teaches people to ignore
 * the one email that must be believed.
 *
 * Everything here is best-effort: `sendEmail` never throws, and the
 * record-and-alert entry point catches its own failures, so a Firestore or
 * Resend outage can never break sign-in. Deliberately NOT gated on
 * `email_verified` — an unverified account is exactly when the alert matters.
 */

/**
 * Counts a delivered alert against the cost meter (AGL-1438) and passes the
 * result through untouched.
 *
 * Wrapping rather than awaiting inline because both senders below `return
 * sendEmail(...)` directly, and their callers read `sent` to decide whether to
 * record the device. A send that never happened is not a cost, so an
 * unconfigured environment meters nothing.
 */
async function meterSent(
  pending: Promise<SendEmailResult>,
): Promise<SendEmailResult> {
  const result = await pending
  if (result.sent) await meterPlatformEmail()
  return result
}

/** Long-lived HttpOnly device-identity cookie, minted by the session route. */
export const DEVICE_COOKIE = 'aglyn_device'

/** A year. Re-set on every mint, so an active device never lapses. */
export const DEVICE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60

/**
 * Firestore subcollection holding a user's recognized devices.
 *
 * Declared in `device-registry.ts` and re-exported here so the existing
 * importers keep working (AGL-1513). It moved because the read/revoke helpers
 * need it and this module reaches the email renderer, whose module-scope brand
 * tokens make importing one constant from here a whole mail stack — see the
 * note on the declaration.
 */
export { DEVICES_COLLECTION } from './device-registry'
// `export … from` does not bind the name locally, and this module uses it.
import { DEVICES_COLLECTION } from './device-registry'

/**
 * How many existing devices the alert decision reads (AGL-1959).
 *
 * It used to read ONE — `devices.limit(1)` — because the only question was
 * "does any device exist". IP-overlap suppression needs to compare against the
 * set, and the set has to be bounded or one person's account turns every
 * sign-in into an unbounded read. Matches `DEVICE_LIMIT` in
 * `/api/account/devices`, so what suppression reasons over is what the owner
 * can actually see listed.
 */
export const DEVICE_SCAN_LIMIT = 50

/**
 * Where the alert's button lands (AGL-1959).
 *
 * A bare `/manage/user` opens the ACCOUNT section — so the person who had just
 * been told a stranger signed in landed on their email address and had to go
 * looking. The surface the mail is about (Recent sign-ins, AGL-2318, plus
 * revoke) lives under Security, so the link names it.
 *
 * From the route table rather than assembled here (AGL-685/693): Security is a
 * route now, and a hand-written path is what goes dead without anything
 * failing to compile. Every alert already delivered carries the previous
 * spelling, `/manage/user?tab=security`, and `/manage/user` still forwards
 * that id to this URL — see `constants/account-sections.ts`.
 */
function accountSecurityUrl(): string {
  const origin = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'
  return `${origin}${buildRoute(Route.MANAGE_USER_SECURITY)}`
}

/**
 * Human summary of a user-agent string — "Chrome on macOS". Coarse on
 * purpose: the recipient needs to recognize the device, not parse a UA.
 */
export function summarizeUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  if (!ua.trim()) return 'Unknown device'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Unknown browser'
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'an unknown OS'
  return `${browser} on ${os}`
}

/** What the alert reports about the request that triggered it. */
export interface SignInClient {
  deviceName: string
  userAgent: string
  /** "City, Region, Country" from Vercel's geo headers, or a fallback. */
  location: string
  ip: string
}

function decodeHeaderPart(value: string | null): string {
  if (!value) return ''
  try {
    // Vercel URI-encodes non-ASCII city names.
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Reads device/location facts off the request headers. Location comes from
 * Vercel's `x-vercel-ip-*` geo headers, so it is approximate and absent in
 * local dev — the email copy treats every field as best-effort.
 */
export function describeSignInClient(headers: {
  get(name: string): string | null
}): SignInClient {
  const userAgent = headers.get('user-agent') ?? ''
  const location =
    [
      decodeHeaderPart(headers.get('x-vercel-ip-city')),
      headers.get('x-vercel-ip-country-region') ?? '',
      headers.get('x-vercel-ip-country') ?? '',
    ]
      .filter(Boolean)
      .join(', ') || 'Unknown location'
  const ip =
    (headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    'Unknown'
  return { deviceName: summarizeUserAgent(userAgent), userAgent, location, ip }
}

/** "2026-08-08 14:03 UTC" — unambiguous without pretending to know a zone. */
export function formatAlertTime(nowMs: number): string {
  return `${new Date(nowMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export interface NewDeviceAlertDetails {
  to: string
  deviceName: string
  location: string
  ip: string
  /** Already formatted, from {@link formatAlertTime}. */
  time: string
}

/**
 * Sends the new-device security alert. Designed template first, hard-coded
 * fallback otherwise — the standard system-email send shape.
 */
export async function sendNewDeviceAlert(
  details: NewDeviceAlertDetails,
): Promise<SendEmailResult> {
  const securityUrl = accountSecurityUrl()
  const merge = {
    'device.name': details.deviceName,
    'device.location': details.location,
    'device.ip': details.ip,
    'device.time': details.time,
    accountSecurityUrl: securityUrl,
  }
  // Mirrors the catalog's defaultBody, so designed and undesigned agree.
  const fallbackText =
    `Your ${PLATFORM_BRAND_NAME} account was just signed in to from a device ` +
    'it has not used before.\n\n' +
    `Device: ${details.deviceName}\n` +
    `Location: ${details.location}\n` +
    `IP address: ${details.ip}\n` +
    `When: ${details.time}\n\n` +
    `Review account security: ${securityUrl}\n\n` +
    'If this was you, no action is needed. If it was not, sign this device ' +
    'out from Recent sign-ins and change your password right away.'
  const designed = await renderSystemEmail('security-new-device', merge)
  // Cost meter (AGL-1438). Platform-scoped: an account alert, sent before any
  // org context is in hand and never subject to a quota.
  return meterSent(
    sendEmail({
    to: details.to,
    subject:
      designed?.subject ?? `New sign-in to your ${PLATFORM_BRAND_NAME} account`,
    text: designed?.text || fallbackText,
    ...(designed?.html ? { html: designed.html } : {}),
    context: 'security-new-device',
    }),
  )
}

export interface PasskeyAddedAlertDetails {
  to: string
  /** Name the passkey was saved under. */
  label: string
  /** Already formatted, from {@link formatAlertTime}. */
  time: string
}

/**
 * Sends the passkey-added security alert.
 *
 * ⚠️ No call site exists yet: the product has no passkey registration
 * (AGL-662 is unbuilt). AGL-662's registration endpoint must call this the
 * moment a credential is stored — the template and trigger are ready so
 * that is one line, not a follow-up ticket.
 */
export async function sendPasskeyAddedAlert(
  details: PasskeyAddedAlertDetails,
): Promise<SendEmailResult> {
  const securityUrl = accountSecurityUrl()
  const merge = {
    'passkey.label': details.label,
    'device.time': details.time,
    accountSecurityUrl: securityUrl,
  }
  const fallbackText =
    `A passkey ("${details.label}") was just added to your ` +
    `${PLATFORM_BRAND_NAME} account. ` +
    'It can be used to sign in without your password.\n\n' +
    `When: ${details.time}\n\n` +
    `Review account security: ${securityUrl}\n\n` +
    'If you did not add this passkey, change your password from Manage ' +
    'account right away.'
  const designed = await renderSystemEmail('security-passkey-added', merge)
  // Cost meter (AGL-1438), as above.
  return meterSent(
    sendEmail({
    to: details.to,
    subject:
      designed?.subject ??
      `A passkey was added to your ${PLATFORM_BRAND_NAME} account`,
    text: designed?.text || fallbackText,
    ...(designed?.html ? { html: designed.html } : {}),
    context: 'security-passkey-added',
    }),
  )
}

export interface RecordDeviceParams {
  firestore: FirebaseFirestore.Firestore
  uid: string
  /** Recipient. Absent (no email on the token) → record but never alert. */
  email: string | null | undefined
  /** Device id from the cookie, or the freshly minted one. */
  deviceId: string
  client: SignInClient
  nowMs: number
}

export interface RecordDeviceOutcome {
  newDevice: boolean
  alerted: boolean
  /**
   * Why no email was sent for a new device, when the reason was IP-overlap
   * suppression rather than "there was nothing to alert about". Returned so
   * the caller — and the tests — can tell a suppressed alert from a first
   * device and from a send that failed; `alerted: false` alone collapses
   * three different outcomes into one.
   */
  suppression?: SuppressionVerdict
}

/**
 * Records the sign-in against the device registry and sends the new-device
 * alert when — and only when — this is a genuinely new device on an account
 * that already has one.
 *
 * Runs inside `after()` off the sign-in critical path, and never throws:
 * any failure is logged and swallowed, because a broken alert pipeline must
 * not become a broken sign-in.
 */
export async function recordDeviceAndMaybeAlert(
  params: RecordDeviceParams,
): Promise<RecordDeviceOutcome> {
  try {
    const devices = params.firestore
      .collection('users')
      .doc(params.uid)
      .collection(DEVICES_COLLECTION)
    const ref = devices.doc(params.deviceId)
    const snapshot = await ref.get()

    if (snapshot.exists) {
      // Known device: touch it, say nothing. This is the idempotence that
      // keeps the alert believable — routine sign-ins are silent.
      await ref.set(
        {
          lastSeenAt: params.nowMs,
          ip: params.client.ip,
          location: params.client.location,
        },
        { merge: true },
      )
      return { newDevice: false, alerted: false }
    }

    // One bounded read answers both questions: is there a prior device at all
    // (account creation or the rollout backfill — never alert on the first),
    // and does any known device share this sign-in's IP and OS (AGL-1959).
    //
    // Deliberately UNORDERED. `orderBy('lastSeenAt')` would silently omit
    // every device recorded before that field existed — Firestore drops
    // documents missing the ordered field rather than erroring — and a device
    // this cannot see is a device it would alert about forever and never
    // count against the suppression cap.
    const existing = await devices.limit(DEVICE_SCAN_LIMIT).get()
    const hasPriorDevice = !existing.empty
    const known: KnownDevice[] = existing.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>
      return {
        id: doc.id,
        ip: typeof data['ip'] === 'string' ? data['ip'] : null,
        deviceName:
          typeof data['deviceName'] === 'string' ? data['deviceName'] : null,
        lastSeenAt: Number(data['lastSeenAt'] ?? 0) || null,
        alertSuppressedAt: Number(data['alertSuppressedAt'] ?? 0) || null,
      }
    })
    const suppression = hasPriorDevice
      ? newDeviceAlertSuppression({
          ip: params.client.ip,
          deviceName: params.client.deviceName,
          known,
          nowMs: params.nowMs,
        })
      : null

    // The record is written whatever the verdict, and the suppression is
    // written ONTO it. Suppression silences the email; it never hides the
    // device. A stranger behind the same NAT gets a quiet mailbox and a
    // visible row, which is the whole difference between less noise and less
    // evidence — and `alertSuppressedAt` is also what the cap counts, so a
    // suppression that was not recorded would be a suppression that never
    // ran out.
    await ref.set({
      userAgent: params.client.userAgent,
      deviceName: params.client.deviceName,
      ip: params.client.ip,
      location: params.client.location,
      createdAt: params.nowMs,
      lastSeenAt: params.nowMs,
      ...(suppression?.suppress
        ? {
            alertSuppressedAt: params.nowMs,
            alertSuppressedBy: suppression.matchedDeviceId,
          }
        : {}),
    })

    if (!hasPriorDevice || !params.email) {
      return { newDevice: true, alerted: false }
    }
    if (suppression?.suppress) {
      return { newDevice: true, alerted: false, suppression }
    }

    const result = await sendNewDeviceAlert({
      to: params.email,
      deviceName: params.client.deviceName,
      location: params.client.location,
      ip: params.client.ip,
      time: formatAlertTime(params.nowMs),
    })
    if (!result.sent) {
      // Not narrowed: discriminated-union narrowing fails across the lib
      // boundary here, so read the failure fields structurally.
      const failure = result as { reason?: string; status?: number }
      console.error(
        '[security-alerts] new-device alert not sent',
        JSON.stringify({ reason: failure.reason, status: failure.status }),
      )
    }
    return {
      newDevice: true,
      alerted: result.sent,
      ...(suppression ? { suppression } : {}),
    }
  } catch (error) {
    console.error('[security-alerts] device record failed', error)
    return { newDevice: false, alerted: false }
  }
}
