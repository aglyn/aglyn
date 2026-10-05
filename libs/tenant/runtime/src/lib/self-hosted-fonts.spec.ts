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

import {
  resetSelfHostedFontsForTests,
  SELF_HOSTED_FONT_CACHE_CONTROL,
  selfHostedThemeFonts,
  serveSelfHostedFont,
} from './self-hosted-fonts'

const CSS = `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v18/lat400.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`

const fetchMock = jest.fn()
const realFetch = global.fetch

beforeEach(() => {
  resetSelfHostedFontsForTests()
  fetchMock.mockReset()
  global.fetch = fetchMock as never
})
afterAll(() => {
  global.fetch = realFetch
})

describe('selfHostedThemeFonts (AGL-3485)', () => {
  const THEME = { fonts: [{ family: 'Inter', weights: [400] }] }

  it("asks Google as a WOFF2 browser, once per stylesheet per process", async () => {
    fetchMock.mockResolvedValue(new Response(CSS))
    const first = await selfHostedThemeFonts(THEME)
    const second = await selfHostedThemeFonts(THEME)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('fonts.googleapis.com/css2?family=Inter:wght@400')
    expect(init.headers['User-Agent']).toMatch(/Chrome\//)
    expect(first).toEqual(second)
    expect(first?.css).toContain('/api/fonts/inter/v18/lat400.woff2')
    expect(first?.preloads).toEqual(['/api/fonts/inter/v18/lat400.woff2'])
  })

  it('answers null — keep the link — when Google cannot be read', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await selfHostedThemeFonts(THEME)).toBeNull()
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))
    resetSelfHostedFontsForTests()
    expect(await selfHostedThemeFonts(THEME)).toBeNull()
  })

  it('asks nothing for a theme with no Google font', async () => {
    expect(await selfHostedThemeFonts({ fonts: [] })).toBeNull()
    expect(await selfHostedThemeFonts(undefined)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('serveSelfHostedFont (AGL-3485)', () => {
  it('serves the file from Google with a year-long immutable policy', async () => {
    fetchMock.mockResolvedValue(
      new Response('WOFF2', { headers: { 'content-length': '5' } }),
    )
    const res = await serveSelfHostedFont('inter/v18/lat400.woff2')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://fonts.gstatic.com/s/inter/v18/lat400.woff2',
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('font/woff2')
    expect(res.headers.get('cache-control')).toBe(SELF_HOSTED_FONT_CACHE_CONTROL)
    expect(SELF_HOSTED_FONT_CACHE_CONTROL).toContain('immutable')
    expect(await res.text()).toBe('WOFF2')
  })

  it('refuses any path that is not a Google font file, asking nobody', async () => {
    for (const path of ['../secrets', 'inter/v18/a.ttf', 'a/b/c/d.woff2']) {
      expect((await serveSelfHostedFont(path)).status).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches nothing when Google fails', async () => {
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }))
    const res = await serveSelfHostedFont('inter/v18/lat400.woff2')
    expect(res.status).toBe(502)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
