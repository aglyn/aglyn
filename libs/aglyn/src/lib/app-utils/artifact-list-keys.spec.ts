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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  artifactCreateListKeys,
  artifactRenameListKeys,
  isListedArtifactCollection,
} from './artifact-list-keys'

/*
 * The worked examples the backfill's `--self-test` asserts too
 * (`tools/scripts/backfill-artifacts-list-keys.mjs`), so the script cannot
 * stamp a key the writers do not.
 */
const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'artifact-list-keys.fixtures.json'),
    'utf8',
  ),
) as {
  create: Array<{ name: string; collection: string; doc: Record<string, unknown>; expected: unknown }>
  rename: Array<{
    name: string
    collection: string
    displayName: unknown
    doc: Record<string, unknown>
    expected: unknown
  }>
}

describe('artifactCreateListKeys', () => {
  it.each(fixtures.create.map((one) => [one.name, one] as const))('%s', (_name, one) => {
    expect(artifactCreateListKeys(one.collection, one.doc)).toEqual(one.expected)
  })

  it('stamps the name keys on every listed collection, and nothing elsewhere', () => {
    for (const collection of ['screens', 'layouts', 'components', 'templates']) {
      expect(isListedArtifactCollection(collection)).toBe(true)
      expect(artifactCreateListKeys(collection, { displayName: 'A' })).toMatchObject({
        nameLower: 'a',
        nameTokens: ['a'],
        nameReversed: 'a',
      })
    }
    expect(isListedArtifactCollection('forms')).toBe(false)
  })
})

describe('artifactRenameListKeys', () => {
  it.each(fixtures.rename.map((one) => [one.name, one] as const))('%s', (_name, one) => {
    expect(artifactRenameListKeys(one.collection, one.displayName, one.doc)).toEqual(one.expected)
  })

  it('writes only the name keys: a rename never restates a kind or a provenance', () => {
    expect(Object.keys(artifactRenameListKeys('templates', 'X', {})).sort()).toEqual([
      'nameLower',
      'nameReversed',
      'nameTokens',
    ])
    expect(Object.keys(artifactRenameListKeys('components', 'X', {})).sort()).toEqual([
      'nameLower',
      'nameReversed',
      'nameTokens',
    ])
  })
})
