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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { readCartId } from './cart-cookie'
import {
  MEMBER_SUSPENDED_ERROR,
  mintMemberSession,
  setMemberCookie,
  verifyMemberPassword,
} from './membership'

// Best-effort per-instance brute-force damper (mirrors AGL-87 unlock).
const attemptsByIp = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10

/** Site member sign-in (AGL-109); sets the session cookie on success. */
export const membershipLoginHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const email = String(req.body?.email ?? '')
    .trim()
    .toLowerCase()
  const password = String(req.body?.password ?? '')
  if (!hostId || !email || !password) {
    return res.status(400).json({ error: 'Invalid request' })
  }
  const ip = String(
    req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown',
  ).split(',')[0]
  const now = Date.now()
  const attempts = (attemptsByIp.get(ip) ?? []).filter(
    (at) => now - at < WINDOW_MS,
  )
  attempts.push(now)
  attemptsByIp.set(ip, attempts)
  if (attempts.length > MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const membersQuery = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('siteMembers')
      .where('email', '==', email)
      .limit(1)
      .get()
    const memberDoc = membersQuery.docs[0]
    if (
      !memberDoc ||
      !verifyMemberPassword(password, memberDoc.get('passwordScrypt'))
    ) {
      return res.status(401).json({ error: 'Wrong email or password' })
    }
    // Suspension gate (AGL-546): console-suspended members cannot sign in.
    // Checked after the password so the message never leaks account
    // existence to guessers who don't hold the credentials.
    if (memberDoc.get('suspended') === true) {
      return res.status(401).json({ error: MEMBER_SUSPENDED_ERROR })
    }
    // Event trigger (AGL-128/148).
    await emitHostEvent(hostId, 'memberSignIn', { email })
    // Cart linkage (AGL-294): stamp the guest cart with the member so
    // abandoned-cart and analytics can attribute it.
    //
    // AGL-1763: `update()`, never `set(..., { merge: true })`. `cartId` is the
    // `aglyn_cart_{hostId}` cookie verbatim — the one value on this request the
    // client chooses — and a merge-set against a missing path CREATES the
    // document. So a member could mint `carts/{anything}` at will, one document
    // per sign-in, each holding a `customerId` and nothing else: no `lines`, no
    // `createdAtMs`, no `updatedAtMs`. Inert to read — `cart.ts` treats a
    // missing `lines` as `[]` — but real storage on the merchant's Firestore
    // and real weight in the per-host document count, growing without bound and
    // belonging to no basket anyone ever filled.
    //
    // Nor is the cookie confined to one document. `CollectionReference.doc()`
    // appends a SLASH-SEPARATED path and refuses it only when the component
    // count comes out odd, so a cookie of `a/b/c` wrote to `carts/a/b/c` — a
    // document at a nesting of the caller's choosing.
    //
    // Refusing loses nothing, which is why this is a plain refusal rather than
    // AGL-1760's refuse-and-record: a cart that does not exist holds no lines,
    // so there is no basket to attribute and no work to strand. `cart.ts` is
    // what creates a cart — on the first POST that puts something in it, with
    // the whole document written. This only ever stamps one.
    //
    // AGL-1769 moved the cookie's name and its validity rule into
    // `cart-cookie.ts`, so a slash-bearing value never reaches `.doc()` from
    // here at all. `update()` stays: the rule bounds the value to ONE document
    // id, and whether THAT document exists is a separate question only the
    // write can answer.
    const cartId = readCartId(req.cookies, hostId)
    if (cartId) {
      try {
        await firestore
          .collection('hosts')
          .doc(hostId)
          .collection('carts')
          .doc(cartId)
          .update({ customerId: memberDoc.id })
      } catch (error) {
        // Absent cart, malformed cookie, or a Firestore failure — none of them
        // may fail a sign-in that has already succeeded, so this stays
        // swallowed as it was. It is no longer SILENT, though: the old
        // `.catch(() => undefined)` could not tell a missing cart from an
        // outage. And the guard is a `try` rather than a `.catch()` because
        // `.doc()` throws SYNCHRONOUSLY on an odd-component path, outside the
        // promise the old handler covered — a mangled cookie used to 500 the
        // member's own sign-in.
        console.error('Cart linkage failed', hostId, error)
      }
    }
    setMemberCookie(res, hostId, mintMemberSession(hostId, memberDoc.id))
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Sign-in failed' })
  }
}
