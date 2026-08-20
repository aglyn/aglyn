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
 * IP-overlap suppression for the new-device alert (AGL-1959, from AGL-665).
 *
 * AGL-665's detection analysis landed on "cookie-based detection, but suppress
 * the email when the sign-in shares an IP with a known device (same machine,
 * cleared cookies) rather than blasting on every miss". Only the first half
 * shipped. The only gate in `recordDeviceAndMaybeAlert` was `hasPriorDevice`,
 * so an account with one recorded device mailed an alert for EVERY
 * unrecognised device cookie: cleared cookies, a private window, a new browser
 * profile, a second browser on the same machine. All false positives, on the
 * one email that has to be believed.
 *
 * ## The thing this must not become
 *
 * "Same IP" is not "same person". A corporate or café NAT puts hundreds of
 * strangers behind one address, so a naive rule hands an attacker sharing the
 * victim's egress IP a permanently silent sign-in — turning a noise fix into a
 * detection hole. Four properties keep that bounded, and each one is a test
 * below:
 *
 * 1. **Suppression silences the EMAIL and nothing else.** The device is still
 *    recorded and still appears in Recent sign-ins, flagged with what
 *    suppressed it. A NAT-sharing attacker gets a quiet mailbox, never an
 *    invisible session — which is the difference between less noise and less
 *    evidence.
 * 2. **The operating system must match too.** Every case AGL-665 named is the
 *    SAME MACHINE — cleared cookies, private window, new profile, second
 *    browser — so the OS is constant across all of them while the browser may
 *    not be. A stranger on the same NAT is usually a different machine. This
 *    costs the one benign case of a phone on the same wifi, which alerts; that
 *    is a genuinely new device and alerting on it is the correct answer.
 * 3. **The matched device must have been seen recently.** An IP that a device
 *    used months ago says nothing about who holds it now — residential
 *    addresses are reassigned, and a stale match is the one most likely to be
 *    a stranger.
 * 4. **A hard cap per rolling day.** Even inside the rules above, an attacker
 *    who does share the NAT and the OS can only farm {@link SUPPRESSION_CAP}
 *    silent devices before every further one alerts anyway. Without it, one
 *    matching device would license unlimited quiet sign-ins forever.
 *
 * A verdict is returned rather than a boolean so the caller can record WHY,
 * and so the tests can tell "suppressed" from each distinct way of not
 * suppressing — a boolean would let two different bugs share one green.
 */

/** How recently the matched device must have been seen. */
export const SUPPRESSION_RECENCY_MS = 30 * 24 * 60 * 60 * 1000

/** The rolling window the cap is counted over. */
export const SUPPRESSION_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * How many alerts may be suppressed per user per {@link SUPPRESSION_WINDOW_MS}.
 *
 * Three covers the honest cases generously — clearing cookies, a private
 * window and a second browser in one day is already an unusual day — and caps
 * what a NAT-sharing attacker can hide at three, after which the account
 * owner is mailed about every one.
 */
export const SUPPRESSION_CAP = 3

/** The facts suppression reads off an already-recorded device. */
export interface KnownDevice {
  id: string
  ip?: string | null
  /** "Chrome on macOS", as {@link summarizeUserAgent} writes it. */
  deviceName?: string | null
  lastSeenAt?: number | null
  /** Set when THIS device's own alert was suppressed. */
  alertSuppressedAt?: number | null
}

export interface SuppressionInput {
  /** IP and device summary of the sign-in being judged. */
  ip: string
  deviceName: string
  known: KnownDevice[]
  nowMs: number
}

export type SuppressionVerdict =
  | { suppress: true; matchedDeviceId: string; reason: 'ip-and-os-overlap' }
  | {
      suppress: false
      reason:
        | 'no-usable-ip'
        | 'no-usable-os'
        | 'no-overlap'
        | 'cap-reached'
    }

/**
 * The OS half of a device summary — the part of "Chrome on macOS" after " on ".
 *
 * Reads the summary rather than re-parsing the user-agent so there is exactly
 * one definition of what OS a request came from. Returns null for
 * `Unknown device` and for `an unknown OS`, and null is a REFUSAL to suppress
 * rather than a wildcard: an unreadable agent is the shape a scripted client
 * arrives in, and it must not be the shape that buys silence.
 */
export function osOf(deviceName: string | null | undefined): string | null {
  const name = (deviceName ?? '').trim()
  if (!name || name === 'Unknown device') return null
  const at = name.lastIndexOf(' on ')
  if (at < 0) return null
  const os = name.slice(at + ' on '.length).trim()
  if (!os || os === 'an unknown OS') return null
  return os
}

/** Is this an IP we can actually compare? */
function usableIp(ip: string | null | undefined): string | null {
  const value = (ip ?? '').trim()
  if (!value || value === 'Unknown') return null
  return value
}

/**
 * Should the new-device alert email be suppressed for this sign-in?
 *
 * Pure, and deliberately so: every input is a value the caller already holds,
 * which is what makes the NAT case testable without a Firestore.
 */
export function newDeviceAlertSuppression(
  input: SuppressionInput,
): SuppressionVerdict {
  const ip = usableIp(input.ip)
  if (!ip) return { suppress: false, reason: 'no-usable-ip' }

  const os = osOf(input.deviceName)
  if (!os) return { suppress: false, reason: 'no-usable-os' }

  const match = input.known.find((device) => {
    if (usableIp(device.ip) !== ip) return false
    if (osOf(device.deviceName) !== os) return false
    const seen = Number(device.lastSeenAt ?? 0)
    // A device with no `lastSeenAt` at all predates that field and cannot be
    // shown to be recent, so it does not qualify — the same direction the
    // tombstone code takes with an undateable tombstone.
    if (!Number.isFinite(seen) || seen <= 0) return false
    return input.nowMs - seen <= SUPPRESSION_RECENCY_MS
  })
  if (!match) return { suppress: false, reason: 'no-overlap' }

  // Counted over the SAME set the match came from, so the cap is enforced
  // against what we actually read rather than against a second query that
  // could see a different window.
  const recentlySuppressed = input.known.filter((device) => {
    const at = Number(device.alertSuppressedAt ?? 0)
    return (
      Number.isFinite(at) && at > 0 && input.nowMs - at <= SUPPRESSION_WINDOW_MS
    )
  }).length
  if (recentlySuppressed >= SUPPRESSION_CAP) {
    return { suppress: false, reason: 'cap-reached' }
  }

  return { suppress: true, matchedDeviceId: match.id, reason: 'ip-and-os-overlap' }
}
