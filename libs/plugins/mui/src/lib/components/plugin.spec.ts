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

import { setKnownPluginInstalls } from '@aglyn/aglyn'
import {
  parsePluginPropsJson,
  placeholderText,
  PLUGIN_DRAWER_CATEGORY,
  muiPluginInstallToPreset,
} from './plugin'

describe('parsePluginPropsJson (AGL-192)', () => {
  it('parses an object and rejects junk/arrays', () => {
    expect(parsePluginPropsJson('{"city":"NYC"}')).toEqual({ city: 'NYC' })
    expect(parsePluginPropsJson('')).toBeUndefined()
    expect(parsePluginPropsJson('not json')).toBeUndefined()
    expect(parsePluginPropsJson('[1,2]')).toBeUndefined()
  })
})

describe('muiPluginInstallToPreset (AGL-190)', () => {
  it('builds a Marketplace-category preset pinning the listing id', () => {
    const preset = muiPluginInstallToPreset({
      $id: 'L1',
      displayName: 'Weather',
      manifest: { name: 'Weather', restrictParent: ['muiStack'] },
    })
    expect(preset).not.toBeNull()
    expect(preset?.$id).toBe('plugin__L1')
    expect(preset?.displayName).toBe('Weather')
    expect(preset?.category).toBe(PLUGIN_DRAWER_CATEGORY)
    expect((preset?.data as any).props.listingId).toBe('L1')
    expect((preset?.data as any).restrictParent).toEqual(['muiStack'])
  })

  it('prefers listingId over $id and falls back to the manifest name', () => {
    const preset = muiPluginInstallToPreset({
      listingId: 'L2',
      $id: 'other',
      manifest: { name: 'Charts' },
    })
    expect((preset?.data as any).props.listingId).toBe('L2')
    expect(preset?.displayName).toBe('Charts')
  })

  it('returns null without a resolvable listing id', () => {
    expect(muiPluginInstallToPreset({ displayName: 'x' })).toBeNull()
  })
})

describe('placeholderText (AGL-1029)', () => {
  afterEach(() => setKnownPluginInstalls(undefined))

  it('asks for a plugin when none is set', () => {
    expect(placeholderText(undefined)).toMatch(/pick an installed plugin/i)
  })

  /**
   * The reported bug: the canvas told authors an installed plugin was not
   * installed, because it inferred installation from compose-injected fields
   * the editor never has. With nothing published, it may not make the claim.
   */
  it('claims nothing about installation when no surface published a list', () => {
    expect(placeholderText('Tfnrb4wJzF')).toBe(
      'Plugin — renders on the published site',
    )
  })

  it('names the plugin once the editor publishes its installs', () => {
    setKnownPluginInstalls([
      { listingId: 'Tfnrb4wJzF', displayName: 'Promo Countdown' },
    ])
    expect(placeholderText('Tfnrb4wJzF')).toBe(
      'Promo Countdown — renders on the published site',
    )
  })

  it('says so when the pin covers the whole workspace', () => {
    setKnownPluginInstalls([
      { listingId: 'Tfnrb4wJzF', displayName: 'Promo Countdown', scope: 'org' },
    ])
    expect(placeholderText('Tfnrb4wJzF')).toMatch(/installed org-wide/)
  })

  /** Earned: there is a list, and this id is genuinely absent from it. */
  it('says not installed only when the id is missing from a published list', () => {
    setKnownPluginInstalls([{ listingId: 'other', displayName: 'Other' }])
    expect(placeholderText('Tfnrb4wJzF')).toBe(
      'Plugin — not installed on this site',
    )
  })

  it('treats an empty published list as a list, not as absence of one', () => {
    setKnownPluginInstalls([])
    expect(placeholderText('Tfnrb4wJzF')).toBe(
      'Plugin — not installed on this site',
    )
  })
})
