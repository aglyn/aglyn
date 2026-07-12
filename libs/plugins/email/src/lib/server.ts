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

import { registerPluginApiRoute, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { createHash, createHmac, timingSafeEqual } from 'crypto'

/**
 * One-click unsubscribe (AGL-161): the campaign sender embeds an
 * HMAC-signed link; a valid signature writes a suppression entry keyed by
 * the email hash. GET so it works from any mail client; idempotent.
 */
const unsubscribeHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query['hostId'] ?? '')
  const email = String(req.query['email'] ?? '')
    .trim()
    .toLowerCase()
  const signature = String(req.query['sig'] ?? '')
  const secret =
    process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.CRON_SECRET
  if (!hostId || !email || !signature || !secret) {
    return res.status(400).send('Invalid unsubscribe link')
  }
  const expected = createHmac('sha256', secret)
    .update(`${hostId}:${email}`)
    .digest('hex')
  const valid =
    expected.length === signature.length &&
    timingSafeEqual(
      new Uint8Array(Buffer.from(expected)),
      new Uint8Array(Buffer.from(signature)),
    )
  if (!valid) return res.status(403).send('Invalid unsubscribe link')

  try {
    const emailHash = createHash('sha256').update(email).digest('hex')
    await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('suppressions')
      .doc(emailHash)
      .set(
        { email, createdAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res
      .status(200)
      .send(
        '<!doctype html><meta name="viewport" content="width=device-width">' +
          '<div style="max-width:420px;margin:15vh auto;padding:24px;' +
          'font-family:system-ui,sans-serif"><h1 style="font-size:22px">' +
          "You're unsubscribed</h1><p style=\"opacity:.8\">You won't " +
          'receive further emails from this site.</p></div>',
      )
  } catch (error) {
    console.error(error)
    return res.status(500).send('Unsubscribe failed — please try again')
  }
}

/** Registers the email plugin's public API routes (AGL-396). */
export function registerEmailApi(): void {
  registerPluginApiRoute('email/unsubscribe', unsubscribeHandler)
}
