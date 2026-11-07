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
 * The editor's repeat sources answer for a node the way the published page
 * expands it (AGL-4212): with two sources' keys on one node, the canvas
 * previews the one `repeatKey` names, and a source whose keys are no entity
 * is named by its own picker's option.
 */

import {
  registerRepeatSource,
  repeatKeyOptionLabel,
  repeatSourceOf,
  type RepeatSource,
} from './repeat-sources'

const source = (id: string, keyProp: string, options?: unknown[]): RepeatSource => ({
  id,
  label: id,
  keyProp,
  keyAttribute: { component: 'select', ...(options ? { options } : {}) },
  useRows: () => ({ status: 'missing' }),
})

describe('repeatSourceOf (AGL-4212)', () => {
  const unregister: Array<() => void> = []
  afterEach(() => {
    while (unregister.length) unregister.pop()?.()
  })

  it('names the source and its trimmed key', () => {
    unregister.push(registerRepeatSource(source('connections', 'repeatConnection')))
    expect(repeatSourceOf({ props: { repeatConnection: ' acme.reviews/google ' } })).toEqual({
      source: expect.objectContaining({ id: 'connections' }),
      key: 'acme.reviews/google',
    })
    expect(repeatSourceOf({ props: {} })).toBeUndefined()
  })

  it('prefers the key the page expands by, whichever source registered first', () => {
    unregister.push(registerRepeatSource(source('connections', 'repeatConnection')))
    unregister.push(registerRepeatSource(source('datasets', 'repeatDataset')))
    const both = { props: { repeatConnection: 'acme.reviews/google', repeatDataset: 'Team' } }
    expect(repeatSourceOf(both)?.source.id).toBe('datasets')
    expect(repeatSourceOf({ props: { repeatConnection: 'acme.reviews/google', repeatDataset: ' ' } })?.source.id).toBe(
      'connections',
    )
  })
})

describe('repeatKeyOptionLabel (AGL-4212)', () => {
  it('reads the label of the option holding the key', () => {
    const picker = source('connections', 'repeatConnection', [
      { value: '', label: 'None' },
      { value: 'acme.reviews/google', label: 'Google: each item' },
    ])
    expect(repeatKeyOptionLabel(picker, 'acme.reviews/google')).toBe('Google: each item')
    expect(repeatKeyOptionLabel(picker, 'acme.reviews/other')).toBeUndefined()
    expect(repeatKeyOptionLabel(source('free', 'repeatFeed'), 'anything')).toBeUndefined()
  })
})
