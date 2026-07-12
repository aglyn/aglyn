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
  if (!hostId || !productId || !EMAIL_PATTERN.test(email)) {
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
