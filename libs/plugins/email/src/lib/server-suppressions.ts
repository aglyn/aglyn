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
 * Putting somebody on the suppression list by hand.
 *
 * ## What was missing
 *
 * The Suppressions card could show an entry and remove one, and there was no
 * way to add one. Every row in production arrived from a machine — somebody
 * clicking unsubscribe, or the Resend webhook on a permanent bounce or a
 * complaint. So the request a merchant is most likely to receive in words
 * rather than through a link — a reply saying "please stop emailing me", a
 * phone call, a message at the counter — had no button.
 *
 * That is a compliance exposure and not only a missing feature: CAN-SPAM
 * requires an opt-out received by ANY means to be honored within ten business
 * days, and every product Aglyn is compared against lets a sender type an
 * address in.
 *
 * ## Why this is a route and not a client write
 *
 * The rules do allow a site editor to write `hosts/{hostId}/suppressions` —
 * that is how the card's Remove button works, and the argument for it holds:
 * removing a row launders no counter and touches no money.
 *
 * ADDING one is a different act, for one concrete reason: **the document id
 * is `sha256` of the normalized address**. A browser computing that itself
 * would be a second derivation of the key that every reader and both writers
 * share, and the failure mode is silent and one-directional — a row filed
 * under `sha256('Bob@x.com')` is invisible to a send path looking up
 * `sha256('bob@x.com')`, so the merchant is told the person is suppressed and
 * the mail keeps going. `emailSuppressionKey` is the one derivation, it lives
 * on the server, and it refuses to guess an id for a value that is not an
 * address rather than filing one under a key nothing will look up.
 *
 * ## Why the per-site list and not the platform one
 *
 * "Stop emailing me" said to a merchant is about that merchant's mail. The
 * platform list is what a hard bounce and a complaint write — evidence about
 * the ADDRESS rather than a preference about one sender — and a merchant
 * cannot put somebody on it, exactly as they cannot take somebody off it.
 */

import {
  registerPluginApiRoute,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  emailSuppressionKey,
  firebaseAdmin,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * The `reason` a hand-added entry carries.
 *
 * A NEW value beside the three the machines write, not a reuse of one of
 * them. Recording it as `'unsubscribe'` would say the person clicked a link
 * they never saw, and the difference is exactly what a merchant asked to
 * prove an opt-out was honored has to be able to show.
 */
export const MANUAL_SUPPRESSION_REASON = 'manual'

/** Bound on the note, so one row stays a small document. */
export const SUPPRESSION_NOTE_MAX = 200

/** The most addresses one request may name. */
export const SUPPRESSION_ADD_BATCH_MAX = 50

/** What happened to one address the operator typed. */
export interface SuppressionAddVerdict {
  /** Exactly what was typed, so a bad line can be pointed at. */
  input: string
  /** The normalized address, or null when there is not one. */
  email: string | null
  /** True when this request created the entry. */
  added: boolean
  /** Why not, when `added` is false. */
  refusal?: 'not-an-address' | 'already-suppressed'
}

/**
 * Splits the request's addresses without deciding anything about them.
 *
 * Newlines AND commas, because an operator pasting from a reply or a
 * spreadsheet produces both, and a paste that silently became one giant
 * "address" would be refused as a whole rather than acted on.
 */
export function readSuppressionAddresses(raw: unknown): string[] {
  const source = Array.isArray(raw) ? raw.join('\n') : String(raw ?? '')
  return source
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, SUPPRESSION_ADD_BATCH_MAX)
}

/**
 * Adds addresses to one site's suppression list.
 *
 * `createdAt` is written only when the document is new, matching both machine
 * writers: a hand-added entry over an existing one must not restamp the date
 * the person actually left, because that is the date a merchant is asked for.
 * An entry that already exists is reported rather than rewritten — a bounce
 * that has been on the list for a month must not be relabeled `manual` and
 * lose the reason a merchant needs to see before removing it.
 */
export const emailSuppressionAddHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    /*
     * AN ALLOWLIST, and the SITE's role rather than the organization's.
     *
     * The list being written is `hosts/{hostId}/suppressions` — one site's
     * own — which the rules already grant a site editor. The list-membership
     * routes beside this one additionally demand org-wide access because a
     * marketing list lives on the ORG and every site in it can mail one;
     * demanding that here would refuse a single-site editor the ability to
     * honor an opt-out about their own site's mail, which is the opposite of
     * what a suppression is for.
     */
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin or editor' })
    }

    const note = String(body.note ?? '')
      .trim()
      .slice(0, SUPPRESSION_NOTE_MAX)
    const inputs = readSuppressionAddresses(body.emails ?? body.email)
    if (!inputs.length) {
      return res.status(400).json({ error: 'No address to suppress' })
    }

    const suppressions = hostRef.collection('suppressions')
    const results: SuppressionAddVerdict[] = []
    const seen = new Set<string>()
    for (const input of inputs) {
      const key = emailSuppressionKey(input)
      if (!key) {
        results.push({
          input,
          email: null,
          added: false,
          refusal: 'not-an-address',
        })
        continue
      }
      // One line naming the same person twice is one entry, and reporting it
      // twice would tell the operator an address was already suppressed by a
      // request they are still making.
      if (seen.has(key)) continue
      seen.add(key)
      const email = input.trim().toLowerCase()
      const ref = suppressions.doc(key)
      const existing = await ref.get()
      if (existing.exists) {
        results.push({
          input,
          email,
          added: false,
          refusal: 'already-suppressed',
        })
        continue
      }
      await ref.set(
        {
          email,
          reason: MANUAL_SUPPRESSION_REASON,
          ...(note ? { note } : {}),
          // WHO recorded it. A suppression is evidence, and evidence with no
          // author answers half the question it is kept for.
          suppressedByUid: decoded.uid,
          createdAt: FieldValue.serverTimestamp(),
          suppressedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      results.push({ input, email, added: true })
    }

    return res.status(200).json({
      added: results.filter((result) => result.added).length,
      results,
    })
  } catch (error) {
    console.error('[email] suppression add failed', error)
    return res
      .status(500)
      .json({ error: 'The address could not be suppressed.' })
  }
}

/**
 * Registration.
 *
 * Not on the machine-path exemption list in `plugin-api-rate-limit.ts`: this
 * is reached by a person pressing a button in a browser, so the visitor
 * limiter's per-(site, IP) budget is far above any real use of it.
 */
export function registerEmailSuppressionsApi(): void {
  registerPluginApiRoute('email/suppression-add', emailSuppressionAddHandler)
}
