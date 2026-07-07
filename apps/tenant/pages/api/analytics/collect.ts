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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { NextApiRequest, NextApiResponse } from 'next'
import { runEventWorkflows } from '../../../utils/run-event-workflows'

/** Firestore map keys can't be parsed as field paths on read anyway, but
 * keep them tame: strip characters that complicate querying/exporting. */
const pathKey = (path: string) =>
  (path || '/').slice(0, 200).replace(/[.$#[\]]/g, '_')

/**
 * Privacy-friendly pageview collector (AGL-82): no cookies, no user ids —
 * one increment per view into a per-day counter doc the console dashboard
 * (and later the AGL-41 metering pipeline) reads. Fire-and-forget from a
 * sendBeacon, so errors just 204.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    const hostId = String(body.hostId ?? '')
    const path = String(body.path ?? '/')
    if (!hostId || hostId.length > 64) return res.status(204).end()

    const day = new Date().toISOString().slice(0, 10)
    await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('analytics')
      .doc(day)
      .set(
        {
          total: FieldValue.increment(1),
          paths: { [pathKey(path)]: FieldValue.increment(1) },
        },
        { merge: true },
      )
    // Event trigger (AGL-128): fire-and-forget — never delays the beacon.
    void runEventWorkflows(hostId, 'pageView', { path })
  } catch (error) {
    console.error(error)
  }
  return res.status(204).end()
}
