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
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Back-in-stock signup (AGL-326): captures an email for a sold-out
 * product; the restock cron emails and clears it once stock returns.
 */
export const notifyRestockHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const productId = String(body.productId ?? '')
  const email = String(body.email ?? '').trim().toLowerCase()
  // AGL-1771/AGL-1774: both were checked non-empty and nothing else, on a
  // handler that needs NO credentials — no session, no member gate, no
  // signature — and they are not equally dangerous.
  //
  // `hostId` is a path component here: `.doc()` appends a SLASH-SEPARATED path
  // rather than taking one opaque id, so `a/b/c` created the alert under
  // `hosts/a/b/c/restockAlerts/…`, beneath a document that does not exist and
  // therefore invisible to every console list, which resolve the host first.
  //
  // `productId` is worse precisely because it is NOT a path component here —
  // it is stored as a FIELD, and `process-restock.ts` makes it a path
  // component later. An even-component value threw synchronously out of that
  // cron's `.doc()`, aborting the whole platform-wide run; and because the
  // alert was never marked `notifiedAtMs` it came back on every later run, so
  // one anonymous POST stopped back-in-stock email for every merchant,
  // permanently. A field is not a path until someone makes it one, and the
  // place to refuse is where it enters (AGL-1774 guards the cron as well, for
  // the rows written before this).
  //
  // Answered separately from the email, following `762621581`: a caller told
  // only "Enter a valid email" when the ids are the problem goes looking for
  // the wrong mistake. A shopper never sees this — the storefront widget fills
  // both ids — so the message is for whoever is driving the endpoint.
  if (!isDocumentId(hostId) || !isDocumentId(productId)) {
    return res
      .status(400)
      .json({ error: 'Missing or invalid hostId or productId' })
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email' })
  }
  try {
    await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('restockAlerts')
      .add({ productId, email, notifiedAtMs: null, createdAtMs: Date.now() })
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Signup failed' })
  }
}
