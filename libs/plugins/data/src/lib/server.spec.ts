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

/**
 * THE ORGANIZATION'S DATASETS API IS THE DATA PLUGIN'S, AT THE SAME ADDRESSES.
 *
 * `/api/orgs/datasets` and `/api/orgs/datasets/export` are served by the
 * console's plugin dispatcher from this registration. A registration that
 * lost a path would 404 the org Data page's every create and export, and one
 * that lost its subject would let the dispatcher's release gate read every
 * request as anonymous — refused under any partial rollout of the store.
 */

import {
  resolvePluginApiMatch,
  resolvePluginApiRequestSubject,
} from '@aglyn/aglyn/server'
import { registerDataConsoleApi } from './server'

beforeAll(() => {
  registerDataConsoleApi()
})

describe('the data plugin console API', () => {
  it.each(['orgs/datasets', 'orgs/datasets/export'])(
    'serves %s at the address the console always answered',
    (path) => {
      expect(resolvePluginApiMatch(path)).toBeTruthy()
    },
  )

  it('names the organization a write is for, from its body', async () => {
    const request = new Request('https://console.aglyn.com/api/orgs/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', action: 'create-dataset' }),
    })
    await expect(
      resolvePluginApiRequestSubject('orgs/datasets', request),
    ).resolves.toEqual({ orgId: 'org-1' })
  })

  it('names the organization an export is for, from its query', async () => {
    const request = new Request(
      'https://console.aglyn.com/api/orgs/datasets/export?orgId=org-2&datasetId=d1',
    )
    await expect(
      resolvePluginApiRequestSubject('orgs/datasets/export', request),
    ).resolves.toEqual({ orgId: 'org-2' })
  })

  it('names nobody when the request names no organization', async () => {
    const request = new Request(
      'https://console.aglyn.com/api/orgs/datasets/export?datasetId=d1',
    )
    await expect(
      resolvePluginApiRequestSubject('orgs/datasets/export', request),
    ).resolves.toBeNull()
  })
})
