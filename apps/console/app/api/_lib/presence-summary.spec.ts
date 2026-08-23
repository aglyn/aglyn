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
import { resolve } from 'node:path'
import {
  PRESENCE_SUMMARY_STALE_MS,
  summarizeOrgPresence,
} from './presence-summary'

const NOW = 1_900_000_000_000
const fresh = (over: Record<string, unknown> = {}) => ({
  displayName: 'Zach Gover',
  lastSeenAt: NOW - 5_000,
  ...over,
})

/**
 * The list summary is a DISPLAY ARTIFACT, not a presence row (AGL-2486).
 *
 * It is produced server-side with ADMIN credentials, which the security rules
 * do not constrain, and it is handed to a page that decorates a list. Both
 * halves of that make leakage the risk worth testing: everything the summary
 * carries has escaped the room it was written in.
 */
describe('nothing but an identity leaves the room', () => {
  it('never carries a cursor', () => {
    // Cursors update at up to 16/s and say where a person is POINTING. A list
    // cannot draw one and has no business knowing it.
    const summary = summarizeOrgPresence(
      {
        screen: {
          doc1: {
            v: { ver1: { u1: { s1: fresh({ cursorX: 0.5, cursorY: 0.25 }) } } },
          },
        },
      },
      NOW,
    )
    expect(JSON.stringify(summary)).not.toContain('cursor')
    expect(summary['screen']['doc1'][0]).toEqual({
      uid: 'u1',
      displayName: 'Zach Gover',
    })
  })

  it('never carries a selection, a colour, or a heartbeat', () => {
    const summary = summarizeOrgPresence(
      {
        screen: {
          doc1: {
            v: {
              ver1: {
                u1: {
                  s1: fresh({
                    selectedNodeId: 'node-42',
                    colour: '#d93025',
                    cursorX: 1,
                  }),
                },
              },
            },
          },
        },
      },
      NOW,
    )
    const person = summary['screen']['doc1'][0]
    // Asserted as an exact object: a field added to presence later cannot
    // ride along unnoticed, because this fails the moment one does.
    expect(Object.keys(person).sort()).toEqual(['displayName', 'uid'])
  })

  it('carries a photo when there is one, since the avatar draws it', () => {
    const summary = summarizeOrgPresence(
      { screen: { d: { v: { v1: { u1: { s1: fresh({ photoURL: 'https://x/a.png' }) } } } } } },
      NOW,
    )
    expect(summary['screen']['d'][0].photoURL).toBe('https://x/a.png')
  })
})

describe('a list row must not claim someone is there when they are not', () => {
  it('uses the same window the editor uses to DRAW someone', () => {
    // Read out of `use-presence.ts` rather than copied, because a copy is what
    // drifts. A list is read at a glance and believed, so it must not report
    // a session the avatar stack would already have stopped drawing.
    const source = readFileSync(
      resolve(__dirname, '..', '..', '..', 'hooks', 'use-presence.ts'),
      'utf8',
    )
    const displayWindow = /PRESENCE_STALE_MS\s*=\s*([\d_]+)/.exec(source)?.[1]
    expect(displayWindow).toBeDefined()
    expect(PRESENCE_SUMMARY_STALE_MS).toBe(Number(displayWindow?.replace(/_/g, '')))
  })

  it('drops a row past the window', () => {
    const summary = summarizeOrgPresence(
      {
        screen: {
          d: {
            v: {
              v1: {
                u1: { s1: { displayName: 'Zach', lastSeenAt: NOW - 600_000 } },
              },
            },
          },
        },
      },
      NOW,
    )
    expect(summary).toEqual({})
  })

  it('keeps a row inside it', () => {
    const summary = summarizeOrgPresence(
      { screen: { d: { v: { v1: { u1: { s1: fresh() } } } } } },
      NOW,
    )
    expect(summary['screen']['d']).toHaveLength(1)
  })

  it('drops a nameless row rather than rendering a question mark', () => {
    expect(
      summarizeOrgPresence(
        { screen: { d: { v: { v1: { u1: { s1: { lastSeenAt: NOW } } } } } } },
        NOW,
      ),
    ).toEqual({})
  })
})

describe('the roll-up answers the question a list row asks', () => {
  it('collapses versions, because "is anyone in this" is the question', () => {
    const summary = summarizeOrgPresence(
      {
        screen: {
          d: {
            v: {
              v1: { u1: { s1: fresh() } },
              v2: { u2: { s1: fresh({ displayName: 'Ada Lovelace' }) } },
            },
          },
        },
      },
      NOW,
    )
    expect(summary['screen']['d'].map((p) => p.uid).sort()).toEqual(['u1', 'u2'])
  })

  it('counts one person once, however many tabs or versions', () => {
    const summary = summarizeOrgPresence(
      {
        screen: {
          d: {
            v: {
              v1: { u1: { s1: fresh(), s2: fresh() } },
              v2: { u1: { s3: fresh() } },
            },
          },
        },
      },
      NOW,
    )
    expect(summary['screen']['d']).toHaveLength(1)
  })

  it('separates documents and document kinds', () => {
    const summary = summarizeOrgPresence(
      {
        screen: { a: { v: { v1: { u1: { s1: fresh() } } } } },
        layout: { b: { v: { v1: { u2: { s1: fresh() } } } } },
      },
      NOW,
    )
    expect(Object.keys(summary).sort()).toEqual(['layout', 'screen'])
    expect(summary['screen']['a']).toHaveLength(1)
    expect(summary['layout']['b']).toHaveLength(1)
  })

  it('still reads LEGACY document-scoped rows while old clients drain', () => {
    expect(
      summarizeOrgPresence({ screen: { d: { u1: { s1: fresh() } } } }, NOW)[
        'screen'
      ]['d'],
    ).toHaveLength(1)
  })

  it('survives an empty or malformed tree', () => {
    expect(summarizeOrgPresence(null, NOW)).toEqual({})
    expect(summarizeOrgPresence({}, NOW)).toEqual({})
    expect(summarizeOrgPresence({ screen: null } as never, NOW)).toEqual({})
    expect(summarizeOrgPresence({ screen: { d: null } } as never, NOW)).toEqual({})
    expect(
      summarizeOrgPresence({ screen: { d: { v: { v1: null } } } } as never, NOW),
    ).toEqual({})
  })
})
