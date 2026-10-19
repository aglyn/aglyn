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

/**
 * `readConfiguredPublicUrl` (AGL-3963): the reading twin of
 * `fetchConfiguredPublicUrl`, for a server that reads a document at an
 * address somebody else's DNS published. It refuses exactly what its twin
 * refuses, before any request: these cases make none.
 */

import { readConfiguredPublicUrl } from './configured-url-fetch'

const never = async () => {
  throw new Error('resolved a name it should have refused first')
}

describe('readConfiguredPublicUrl refuses before it connects', () => {
  it.each([
    ['http://api.provider.example/v2/x/settings', 'not-https'],
    ['https://user:pass@api.provider.example/v2', 'credentials'],
    ['https://api.provider.example:8443/v2', 'port'],
    ['not a url', 'malformed'],
  ])('%s → %s', async (url, refusal) => {
    await expect(readConfiguredPublicUrl(url, {}, { maxBytes: 1024, resolve: never })).resolves.toMatchObject({
      ok: false,
      refusal,
    })
  })

  it('refuses a name that resolves to a private address', async () => {
    await expect(
      readConfiguredPublicUrl('https://metadata.provider.example/v2', {}, { maxBytes: 1024, resolve: async () => null }),
    ).resolves.toEqual({ ok: false, refusal: 'private-address', host: 'metadata.provider.example' })
  })
})
