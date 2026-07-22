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

// Realtime Database rules matrix (AGL-675). Until now RTDB was provisioned
// but deny-all and untested, while every Firestore rule in this repo has a
// negative control. Presence is the first thing to open it, so the coverage
// comes first.
//
// The authorization model is unusual and worth stating: RTDB rules CANNOT
// read Firestore, and the ordinary auth token carries no org membership.
// So access rides a `presenceOrg` claim on a SEPARATE short-lived token
// minted by /api/presence/token, which checks membership server-side —
// the same shape as the media upload-URL route, which exists because
// Storage rules have the identical limitation.

import { after, before, beforeEach, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { get, ref, set } from 'firebase/database'

const here = dirname(fileURLToPath(import.meta.url))

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let env

const ORG = 'org-acme'
const OTHER_ORG = 'org-other'
const MEMBER = 'uid-member'
const OTHER_MEMBER = 'uid-other-member'
const OUTSIDER = 'uid-outsider'
const DOC = 'presence/org-acme/screen/screen-1'

/** A session holding a presence token for `orgId`. */
const scoped = (uid, orgId) =>
  env.authenticatedContext(uid, { presenceOrg: orgId }).database()
/** A signed-in session with NO presence claim — an ordinary console token. */
const plain = (uid) => env.authenticatedContext(uid).database()
const anon = () => env.unauthenticatedContext().database()

const validEntry = (name = 'Sam') => ({
  displayName: name,
  lastSeenAt: 1_700_000_000_000,
})

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-check',
    database: {
      rules: readFileSync(join(here, '..', 'firebase-database.rules.json'), 'utf8'),
    },
  })
})
after(async () => {
  await env?.cleanup()
})
beforeEach(async () => {
  await env.clearDatabase()
})

describe('presence access', () => {
  it('a scoped member writes their own entry and reads the room', async () => {
    await assertSucceeds(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}`), validEntry()),
    )
    await assertSucceeds(get(ref(scoped(MEMBER, ORG), DOC)))
  })

  /**
   * The whole reason this rule set exists. An ordinary console token has no
   * `presenceOrg` claim, so simply being signed in is not enough — otherwise
   * anyone who knew a host id could watch who was editing what.
   */
  it('an ordinary signed-in token cannot read or write presence', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await set(ref(context.database(), `${DOC}/${MEMBER}`), validEntry())
    })
    await assertFails(get(ref(plain(MEMBER), DOC)))
    await assertFails(
      set(ref(plain(MEMBER), `${DOC}/${MEMBER}`), validEntry()),
    )
    await assertFails(get(ref(anon(), DOC)))
  })

  it('a token scoped to another org sees nothing here', async () => {
    await assertFails(get(ref(scoped(OUTSIDER, OTHER_ORG), DOC)))
    await assertFails(
      set(ref(scoped(OUTSIDER, OTHER_ORG), `${DOC}/${OUTSIDER}`), validEntry()),
    )
  })

  /** Presence is a statement about yourself; impersonating another editor
   *  would let someone plant a ghost or move somebody else's cursor. */
  it('cannot write somebody else’s entry', async () => {
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${OTHER_MEMBER}`), validEntry('Not me')),
    )
  })

  it('the deny-all default still covers everything else', async () => {
    await assertFails(set(ref(scoped(MEMBER, ORG), 'anythingElse'), { a: 1 }))
    await assertFails(get(ref(scoped(MEMBER, ORG), 'anythingElse')))
  })
})

describe('presence shape', () => {
  it('requires the fields the UI actually renders', async () => {
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}`), { displayName: 'Sam' }),
    )
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}`), {
        lastSeenAt: 1_700_000_000_000,
      }),
    )
  })

  /** Unbounded strings in a record every collaborator renders is how one
   *  person makes the editor unusable for everyone else. */
  it('bounds the strings it renders', async () => {
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}`), {
        ...validEntry('x'.repeat(200)),
      }),
    )
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}`), {
        ...validEntry(),
        selectedNodeId: 'y'.repeat(500),
      }),
    )
  })

  it('rejects fields nobody declared', async () => {
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}`), {
        ...validEntry(),
        smuggled: 'anything',
      }),
    )
  })

  it('accepts the full declared entry', async () => {
    await assertSucceeds(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}`), {
        ...validEntry(),
        selectedNodeId: 'node-1',
        photoURL: 'https://example.com/a.png',
        colour: '#ff8800',
      }),
    )
  })
})
