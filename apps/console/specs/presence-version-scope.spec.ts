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
import { join, resolve } from 'node:path'
import {
  PRESENCE_CURRENT_VERSION,
  presenceRoomPath,
} from '../hooks/use-presence'

/**
 * Presence is scoped to a VERSION, and to the SAME version the mirror is
 * (AGL-2486).
 *
 * Zach's decision: you should only see people editing the version you are
 * editing. Presence was keyed per document while the co-edit mirror was keyed
 * per version, so two people on different versions of one screen appeared to
 * each other as collaborators while not one of their edits reached the other.
 *
 * The two keys are built in different files, by different code, and nothing
 * but agreement makes the feature work — so agreement is what these assert.
 */
describe('a version-scoped presence room', () => {
  it('separates two versions of one document', () => {
    // The case that motivated the change.
    expect(presenceRoomPath('org', 'screen', 'doc', 'v1')).not.toBe(
      presenceRoomPath('org', 'screen', 'doc', 'v2'),
    )
  })

  it('puts two sessions on the SAME version in one room', () => {
    expect(presenceRoomPath('org', 'screen', 'doc', 'v1')).toBe(
      presenceRoomPath('org', 'screen', 'doc', 'v1'),
    )
  })

  it('keeps the literal `v` segment the rules depend on', () => {
    // Version rooms live beside the LEGACY `$uid` wildcard, and only the
    // literal keeps a version id from being read as a uid. Drop it and the
    // rules would match `$versionId={uid}, $uid={sessionId}`, compare an
    // account against a tab, and refuse every write.
    expect(presenceRoomPath('org', 'screen', 'doc', 'v1')).toBe(
      'presence/org/screen/doc/v/v1',
    )
  })

  it('falls back to the mirror’s own sentinel for a document with no versions', () => {
    // The template editor passes `versionId: undefined` to BOTH hooks.
    expect(presenceRoomPath('org', 'template', 'tpl', undefined)).toBe(
      `presence/org/template/tpl/v/${PRESENCE_CURRENT_VERSION}`,
    )
  })
})

describe('presence and the co-edit mirror cannot drift apart', () => {
  const MIRROR = readFileSync(
    resolve(__dirname, '..', 'hooks', 'use-coediting.ts'),
    'utf8',
  )

  it('uses the sentinel the mirror actually uses, read from its source', () => {
    // Asserted against the mirror's SOURCE rather than a copy of the string,
    // because a copy is exactly what drifts. `use-coediting.ts` builds
    // `…/${versionId ?? 'current'}/nodes`.
    const sentinel = /versionId \?\? '([^']+)'/.exec(MIRROR)?.[1]
    expect(sentinel).toBeDefined()
    expect(PRESENCE_CURRENT_VERSION).toBe(sentinel)
  })

  it('scopes on the same version identifier the mirror scopes on', () => {
    // Both must place `versionId` after `docId`. If the mirror ever moves its
    // version segment, this fails rather than letting the two quietly diverge.
    expect(MIRROR).toMatch(/\$\{docType\}\/\$\{docId\}\//)
    expect(presenceRoomPath('o', 'screen', 'd', 'ver')).toContain('/d/v/ver')
  })
})

describe('every editor passes its version to presence', () => {
  const ROOT = resolve(__dirname, '..')
  const PAGES: [string, string][] = [
    ['screens/[screenId]/versions/[versionId]', 'versionId,'],
    ['components/[componentId]/versions/[versionId]', 'versionId,'],
    ['layouts/[layoutId]/versions/[versionId]', 'versionId,'],
    ['emails/[templateKey]/versions/[versionId]', 'versionId,'],
    // No versions of its own; shares the mirror's sentinel through `undefined`.
    ['templates/[templateId]', 'versionId: undefined,'],
  ]

  it.each(PAGES)('%s passes %s', (route, expected) => {
    const path = join(
      ROOT,
      'app',
      '(editor)',
      '[orgSlug]',
      'hosts',
      '[host]',
      route,
      'besigner',
      'page.tsx',
    )
    const call = /usePresence\(\{[\s\S]{0,400}?\}\)/.exec(
      readFileSync(path, 'utf8'),
    )?.[0]
    expect(call).toBeDefined()
    expect(call).toContain(expected)
  })
})
