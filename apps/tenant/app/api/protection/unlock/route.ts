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

import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { createHash, timingSafeEqual } from 'crypto'

export const dynamic = 'force-dynamic'

// Best-effort per-instance brute-force damper.
const attemptsByIp = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10

const json = (body: unknown, status = 200) => Response.json(body, { status })

/**
 * Password unlock for protected screens (AGL-87): verifies the sha256 of
 * the supplied password against the screen doc and only then returns the
 * composed node tree — protected content never ships in static HTML.
 */
export async function POST(request: Request): Promise<Response> {
  const { hostId, screenId, password } = (await request
    .json()
    .catch(() => ({}))) as Record<string, unknown>
  if (
    typeof hostId !== 'string' ||
    typeof screenId !== 'string' ||
    typeof password !== 'string' ||
    !hostId ||
    !screenId
  ) {
    return json({ error: 'Invalid request' }, 400)
  }
  const ip = String(
    request.headers.get('x-forwarded-for') ?? 'unknown',
  ).split(',')[0]
  const now = Date.now()
  const attempts = (attemptsByIp.get(ip) ?? []).filter((at) => now - at < WINDOW_MS)
  attempts.push(now)
  attemptsByIp.set(ip, attempts)
  if (attempts.length > MAX_ATTEMPTS) {
    return json({ error: 'Too many attempts' }, 429)
  }

  try {
    const screenRes = await getScreen({ hostId, screenId })
    const stored = (screenRes.screen as any)?.protection?.passwordHash
    if (!screenRes.screen || typeof stored !== 'string' || !stored) {
      return json({ error: 'Not protected' }, 404)
    }
    const supplied = createHash('sha256').update(password).digest('hex')
    const match =
      stored.length === supplied.length &&
      timingSafeEqual(
        Buffer.from(stored, 'utf8') as any,
        Buffer.from(supplied, 'utf8') as any,
      )
    if (!match) {
      return json({ error: 'Wrong password' }, 401)
    }
    const nodes = await composeScreenNodes({
      hostId,
      screenId,
      screen: screenRes.screen,
    })
    if (!nodes) return json({ error: 'Compose failed' }, 500)
    return json({ nodes })
  } catch (error) {
    console.error(error)
    return json({ error: 'Unlock failed' }, 500)
  }
}
