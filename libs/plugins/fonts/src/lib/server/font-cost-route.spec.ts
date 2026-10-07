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

const mockVerify = jest.fn()
const mockHost = jest.fn()
const mockCost = jest.fn()

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  class EmailNotVerifiedError extends Error {}
  return {
    EmailNotVerifiedError,
    verifyConsoleIdToken: (token: string) => mockVerify(token),
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({ doc: (id: string) => ({ get: async () => mockHost(id) }) }),
        }),
      }),
    },
  }
})
jest.mock('@aglyn/tenant-runtime/self-hosted-fonts', () => ({
  themeFontDeliveryCost: (...args: unknown[]) => mockCost(...args),
}))

import { fontCostHandler, readCostTheme } from './font-cost-route'

function call(body: unknown, headers: Record<string, string> = { authorization: 'Bearer t' }, method = 'POST') {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
    },
    setHeader(name: string, value: unknown) {
      this.headers[name] = value
    },
    send() {},
    redirect() {},
    end() {},
  }
  return Promise.resolve(
    fontCostHandler({ method, body, headers, query: {}, cookies: {} } as never, res as never),
  ).then(() => res)
}

const THEME = {
  fonts: [{ family: 'Inter', weights: [400, 700], italics: [400], source: 'google', category: 'sans-serif' }],
  typography: { fontFamily: '"Inter", sans-serif', variants: { h1: { fontFamily: '"Lora", serif', fontWeight: 800 } } },
}

beforeEach(() => {
  mockVerify.mockReset().mockResolvedValue({ uid: 'u1' })
  mockHost.mockReset().mockReturnValue({ exists: true, data: () => ({ memberRoles: { u1: 'editor' } }) })
  mockCost.mockReset().mockResolvedValue({ families: [], bytes: 38_000, files: 2, complete: true })
})

describe('POST /api/fonts/cost (AGL-3656)', () => {
  it('prices the theme for a member of the site, as its pages load it', async () => {
    const res = await call({ hostId: 'h1', siteKey: 'studio', theme: THEME })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ families: [], bytes: 38_000, files: 2, complete: true })
    const [theme, options] = mockCost.mock.calls[0]
    expect(theme).toEqual(THEME)
    expect(options.hostId).toBe('h1')
    expect(options.baseTypography.h1).toEqual(expect.objectContaining({ fontWeight: expect.anything() }))
    expect(res.headers['Cache-Control']).toBe('private, max-age=300')
  })

  it('refuses anyone but a signed-in member of the site', async () => {
    expect((await call({ hostId: 'h1', theme: THEME }, {})).statusCode).toBe(401)
    mockHost.mockReturnValue({ exists: true, data: () => ({ memberRoles: { u2: 'admin' } }) })
    expect((await call({ hostId: 'h1', theme: THEME })).statusCode).toBe(403)
    mockHost.mockReturnValue({ exists: false })
    expect((await call({ hostId: 'h1', theme: THEME })).statusCode).toBe(404)
    expect((await call({ hostId: '../x', theme: THEME })).statusCode).toBe(400)
    expect((await call({ hostId: 'h1' }, undefined, 'GET')).statusCode).toBe(405)
    expect(mockCost).not.toHaveBeenCalled()
  })

  it('reads only the font fields of a theme, within bounds', () => {
    const read = readCostTheme({
      fonts: [
        { family: 'Inter', weights: [400, 'x', 5000, 700] },
        { family: 'https://evil.example', weights: [400] },
        { family: 'Brand Sans!', source: 'custom', faces: [{ weight: 400, style: 'normal', src: 'media:x', bytes: 9000 }, { style: 'bold' }] },
        ...Array.from({ length: 10 }, (_, index) => ({ family: `F${index}` })),
      ],
      typography: { fontFamily: 'x'.repeat(500), variants: { h1: { fontFamily: '"Lora", serif', color: 'red' }, 'a b': {} } },
      colorSchemes: { light: {} },
    })
    expect(read.fonts?.map((font) => font.family)).toEqual(['Inter', 'Brand Sans!', 'F0', 'F1', 'F2'])
    expect(read.fonts?.[0].weights).toEqual([400, 700])
    expect(read.fonts?.[1].faces).toEqual([{ weight: 400, style: 'normal', src: '', bytes: 9000 }])
    expect(read.typography).toEqual({ variants: { h1: { fontFamily: '"Lora", serif' } } })
    expect(readCostTheme(null)).toEqual({ typography: {} })
  })
})
