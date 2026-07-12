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
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { readMemberSession } from './membership'

/**
 * Members-only screen content (AGL-109/309): like the AGL-87 unlock API,
 * the node tree never ships in static HTML — it is returned here only when
 * the visitor's session cookie verifies for this host.
 */
export const membershipContentHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.body?.hostId ?? '')
  const screenId = String(req.body?.screenId ?? '')
  if (!hostId || !screenId) {
    return res.status(400).json({ error: 'Invalid request' })
  }
  const memberId = readMemberSession(req, hostId)
  if (!memberId) return res.status(401).json({ error: 'Sign in required' })
  try {
    const screenRes = await getScreen({ hostId, screenId })
    if (!screenRes.screen) {
      return res.status(404).json({ error: 'Unknown screen' })
    }
    const nodes = await composeScreenNodes({
      hostId,
      screenId,
      screen: screenRes.screen,
    })
    if (!nodes) return res.status(404).json({ error: 'No published version' })
    return res.status(200).json({ nodes })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Content fetch failed' })
  }
}
