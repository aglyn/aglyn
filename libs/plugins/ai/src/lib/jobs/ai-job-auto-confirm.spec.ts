/**
 * @jest-environment node
 *
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

import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { aiJobAdmittedInputs, aiJobAutoConfirms } from './ai-job-auto-confirm'

describe('a guided site start confirms its own plan (AGL-3594)', () => {
  const { firestore } = aiEvalMemoryFirestore({
    'hosts/bare': { screens: {} },
    'hosts/starter': { screens: { scrHome: '/' }, defaultHomeScreenId: 'scrHome' },
    'hosts/live': { screens: { scrMine: '/' } },
  })
  const admit = (kind: string, hostId: string | null, inputs: Record<string, unknown>) =>
    aiJobAdmittedInputs(firestore, { kind, hostId, inputs })

  it('keeps it on a site job for a site that publishes nothing of the owner’s yet', async () => {
    await expect(admit('site', 'bare', { pages: 2, autoConfirm: true })).resolves.toEqual({ pages: 2, autoConfirm: true })
    await expect(admit('site', 'starter', { autoConfirm: true })).resolves.toEqual({ autoConfirm: true })
  })

  it('drops it everywhere else, so those jobs wait for a person', async () => {
    await expect(admit('site', 'live', { pages: 5, autoConfirm: true })).resolves.toEqual({ pages: 5 })
    await expect(admit('page', 'bare', { autoConfirm: true })).resolves.toEqual({})
    await expect(admit('site', null, { autoConfirm: true })).resolves.toEqual({})
    await expect(admit('site', 'missing', { autoConfirm: true })).resolves.toEqual({})
    await expect(admit('site', 'bare', { autoConfirm: 'yes' })).resolves.toEqual({})
    // A request that never asked is passed through untouched.
    const inputs = { pages: 2 }
    await expect(admit('site', 'bare', inputs)).resolves.toBe(inputs)
  })

  it('is read off the stored job by kind and input alone', () => {
    expect(aiJobAutoConfirms({ kind: 'site', inputs: { autoConfirm: true } })).toBe(true)
    expect(aiJobAutoConfirms({ kind: 'page', inputs: { autoConfirm: true } })).toBe(false)
    expect(aiJobAutoConfirms({ kind: 'site', inputs: {} })).toBe(false)
  })
})
