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

/**
 * AGL-4049 · the styles a new site can start in, and the record of the one
 * it was created with. The AI plugin's kinds are held to this list in
 * `ai-site-kinds.spec.ts`; the console serves each picture at its path.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  SITE_STYLE_AUTO,
  SITE_STYLES,
  hostCreatedEventParams,
  hostStarterChoice,
  isSiteStyleId,
  readHostStarterChoice,
  siteStyleOf,
} from './site-styles'

const ROOT = join(__dirname, '../../../../..')

describe('SITE_STYLES', () => {
  it('lists the 21 styles, each id once, with a name, a line and a picture', () => {
    expect(SITE_STYLES).toHaveLength(21)
    expect(new Set(SITE_STYLES.map((style) => style.id)).size).toBe(21)
    for (const style of SITE_STYLES) {
      expect(style.name.trim()).not.toBe('')
      expect(style.blurb.trim()).not.toBe('')
      expect(style.alt.trim()).not.toBe('')
      expect(style.preview).toBe(`/_static/starter/styles/${style.id}.webp`)
    }
  })

  it('has a picture the console serves for every style', () => {
    for (const style of SITE_STYLES) {
      expect(existsSync(join(ROOT, 'apps/console/public', style.preview))).toBe(true)
    }
  })

  it('never lists "Pick for me" as a style: it is the AI start\'s card, not a look', () => {
    expect(isSiteStyleId(SITE_STYLE_AUTO)).toBe(false)
    expect(siteStyleOf(SITE_STYLE_AUTO)).toBeNull()
  })

  it('knows a style by its id, and nothing else', () => {
    expect(isSiteStyleId('trades')).toBe(true)
    expect(siteStyleOf('trades')?.name).toBe('Home services & trades')
    for (const value of ['', 'Trades', 'nope', null, undefined, 3, {}]) {
      expect(isSiteStyleId(value)).toBe(false)
    }
  })
})

describe('a site\'s starter choice', () => {
  it('fills what was not chosen', () => {
    expect(hostStarterChoice({ start: 'api' })).toEqual({
      listingId: null,
      version: null,
      kind: null,
      mode: 'base',
      start: 'api',
    })
    expect(hostStarterChoice({ start: 'starter', kind: 'trades' }).kind).toBe('trades')
    expect(hostStarterChoice({ start: 'starter', listingId: 'l-1', version: 3 as never }).version).toBe('3')
  })

  it('reads a stored choice defensively', () => {
    expect(readHostStarterChoice({ start: 'ai', kind: 'auto', mode: 'base' })).toEqual({
      listingId: null,
      version: null,
      kind: 'auto',
      mode: 'base',
      start: 'ai',
    })
    expect(readHostStarterChoice({ start: 'nope' })).toBeNull()
    expect(readHostStarterChoice(null)).toBeNull()
    expect(readHostStarterChoice(['starter'])).toBeNull()
  })

  it('becomes the host_created parameters: ids, `auto` and `none`, never a typed name', () => {
    expect(hostCreatedEventParams(hostStarterChoice({ start: 'starter', kind: 'yoga' }))).toEqual({
      start: 'starter',
      starter_kind: 'yoga',
      starter_listing: 'none',
    })
    expect(hostCreatedEventParams(hostStarterChoice({ start: 'ai', kind: SITE_STYLE_AUTO }))).toEqual({
      start: 'ai',
      starter_kind: 'auto',
      starter_listing: 'none',
    })
    expect(
      hostCreatedEventParams(hostStarterChoice({ start: 'starter', kind: 'store', listingId: 'fp-starter-store-base' })),
    ).toEqual({ start: 'starter', starter_kind: 'store', starter_listing: 'fp-starter-store-base' })
    expect(hostCreatedEventParams(null)).toEqual({ start: 'unknown', starter_kind: 'none', starter_listing: 'none' })
  })
})
