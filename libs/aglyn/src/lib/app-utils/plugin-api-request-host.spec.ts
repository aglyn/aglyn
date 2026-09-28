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

import { pluginRequestFromWeb } from './api-adapter'
import { pluginApiRequestHost } from './plugin-api-request-host'

const post = (url: string, body: string, contentType: string) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  })

describe('pluginApiRequestHost (AGL-3360)', () => {
  it('reads the same site the handler will read, for every body shape', async () => {
    for (const request of [
      post('https://x.test/api/a', '{"hostId":"h1"}', 'application/json'),
      post('https://x.test/api/a', '{"hostId":"h1"}', 'text/plain'),
      post('https://x.test/api/a', 'hostId=h1&x=1', 'application/x-www-form-urlencoded'),
    ]) {
      const named = await pluginApiRequestHost(request)
      const handlerBody = (await pluginRequestFromWeb(request)).body as unknown
      const parsed =
        typeof handlerBody === 'string' ? JSON.parse(handlerBody) : handlerBody
      expect(named).toEqual({ hostId: 'h1', conflict: false })
      expect(String((parsed as { hostId?: unknown }).hostId)).toBe(named.hostId)
    }
  })

  it('flags a query and a body that name different sites', async () => {
    expect(
      await pluginApiRequestHost(
        post('https://x.test/api/a?hostId=open', '{"hostId":"locked"}', 'application/json'),
      ),
    ).toEqual({ hostId: '', conflict: true })
    expect(
      await pluginApiRequestHost(new Request('https://x.test/api/a?hostId=a&hostId=b')),
    ).toEqual({ hostId: '', conflict: true })
  })

  it('agrees when both name the same site, and reads nothing on a GET body', async () => {
    expect(
      await pluginApiRequestHost(
        post('https://x.test/api/a?hostId=h1', '{"hostId":"h1"}', 'application/json'),
      ),
    ).toEqual({ hostId: 'h1', conflict: false })
    expect(await pluginApiRequestHost(new Request('https://x.test/api/a'))).toEqual({
      hostId: '',
      conflict: false,
    })
  })
})
