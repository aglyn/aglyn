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

import * as route from '../app/api/domain-proof/openai-apps-challenge/route'
import { CONSOLE_HOSTNAME, WORKSPACE_DOMAIN } from '../constants/workspace-domain'

/**
 * The domain proof for OpenAI's plugin directory (AGL-4225): the token comes
 * from the environment, is served as the whole body, and the path answers 404
 * whenever there is no well-formed token to serve.
 */
const TOKEN = 'spec-token_0123456789.ABCdef~xyz'

const saved = process.env['OPENAI_APPS_CHALLENGE']
afterEach(() => {
  if (saved === undefined) delete process.env['OPENAI_APPS_CHALLENGE']
  else process.env['OPENAI_APPS_CHALLENGE'] = saved
})

const get = (host: string = CONSOLE_HOSTNAME) =>
  route.GET(new Request(`https://${host}/api/domain-proof/openai-apps-challenge`, { headers: { host } }))

async function expectBare404(response: Response) {
  expect(response.status).toBe(404)
  expect(await response.text()).toBe('')
  expect(response.headers.get('cache-control')).toBe('no-store')
}

describe('the OpenAI domain proof route', () => {
  it('answers 404 with no body while the token is unset', async () => {
    delete process.env['OPENAI_APPS_CHALLENGE']
    await expectBare404(get())
  })

  it.each([['empty', ''], ['whitespace', '  \n']])('answers 404 for an %s value', async (_label, value) => {
    process.env['OPENAI_APPS_CHALLENGE'] = value
    await expectBare404(get())
  })

  it('serves exactly the token, as plain text, never cached', async () => {
    process.env['OPENAI_APPS_CHALLENGE'] = TOKEN
    const response = get()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe(TOKEN)
  })

  it('drops the whitespace a pasted value carries, and adds no newline', async () => {
    process.env['OPENAI_APPS_CHALLENGE'] = `  ${TOKEN}\n`
    const body = await get().text()
    expect(body).toBe(TOKEN)
    expect(body.endsWith('\n')).toBe(false)
  })

  it.each([
    ['too short', 'abc1234'],
    ['too long', 'a'.repeat(513)],
    ['a space inside', 'spec token 0123456789'],
    ['markup', '<script>alert(1)</script>'],
    ['a JSON document', '{"token":"spec-token-0123456789"}'],
    ['a pasted assignment', `OPENAI_APPS_CHALLENGE=${TOKEN}`],
    ['two lines', `${TOKEN}\n${TOKEN}`],
  ])('answers 404 for a malformed value: %s', async (_label, value) => {
    process.env['OPENAI_APPS_CHALLENGE'] = value
    await expectBare404(get())
  })

  it('answers 404 on the auth origin even with a token set', async () => {
    process.env['OPENAI_APPS_CHALLENGE'] = TOKEN
    await expectBare404(get(`auth.${WORKSPACE_DOMAIN}`))
  })

  it('answers 404 when the edge forwards a request for the auth origin', async () => {
    process.env['OPENAI_APPS_CHALLENGE'] = TOKEN
    await expectBare404(
      route.GET(
        new Request('https://internal.example/api/domain-proof/openai-apps-challenge', {
          headers: { host: 'internal.example', 'x-forwarded-host': `auth.${WORKSPACE_DOMAIN}` },
        }),
      ),
    )
  })

  it('is GET only, and is read per request rather than prerendered', () => {
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic'])
    expect(route.dynamic).toBe('force-dynamic')
  })
})
