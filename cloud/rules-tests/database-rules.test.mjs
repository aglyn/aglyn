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

import assert from 'node:assert/strict'
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
// Presence is keyed per TAB under the uid, so one person in two tabs is two
// entries and neither closing removes the other (AGL-675).
const SESSION = 'tab-one'
const OTHER_SESSION = 'tab-two'

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
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}/${SESSION}`), validEntry()),
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
      await set(
        ref(context.database(), `${DOC}/${MEMBER}/${SESSION}`),
        validEntry(),
      )
    })
    await assertFails(get(ref(plain(MEMBER), DOC)))
    await assertFails(
      set(ref(plain(MEMBER), `${DOC}/${MEMBER}/${SESSION}`), validEntry()),
    )
    await assertFails(get(ref(anon(), DOC)))
  })

  it('a token scoped to another org sees nothing here', async () => {
    await assertFails(get(ref(scoped(OUTSIDER, OTHER_ORG), DOC)))
    await assertFails(
      set(
        ref(scoped(OUTSIDER, OTHER_ORG), `${DOC}/${OUTSIDER}/${SESSION}`),
        validEntry(),
      ),
    )
  })

  /** Presence is a statement about yourself; impersonating another editor
   *  would let someone plant a ghost or move somebody else's cursor. */
  it('cannot write somebody else’s entry', async () => {
    await assertFails(
      set(
        ref(scoped(MEMBER, ORG), `${DOC}/${OTHER_MEMBER}/${SESSION}`),
        validEntry('Not me'),
      ),
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
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}/${SESSION}`), { displayName: 'Sam' }),
    )
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}/${SESSION}`), {
        lastSeenAt: 1_700_000_000_000,
      }),
    )
  })

  /** Unbounded strings in a record every collaborator renders is how one
   *  person makes the editor unusable for everyone else. */
  it('bounds the strings it renders', async () => {
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}/${SESSION}`), {
        ...validEntry('x'.repeat(200)),
      }),
    )
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}/${SESSION}`), {
        ...validEntry(),
        selectedNodeId: 'y'.repeat(500),
      }),
    )
  })

  it('rejects fields nobody declared', async () => {
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}/${SESSION}`), {
        ...validEntry(),
        smuggled: 'anything',
      }),
    )
  })

  it('accepts the full declared entry', async () => {
    await assertSucceeds(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}/${SESSION}`), {
        ...validEntry(),
        selectedNodeId: 'node-1',
        photoURL: 'https://example.com/a.png',
        colour: '#ff8800',
      }),
    )
  })
})

/**
 * One person, two tabs (AGL-675). Presence used to be keyed on uid alone, so
 * two tabs were one entry: whichever closed first removed it and the tab
 * still open disappeared from everybody else's room.
 */
describe('one person in more than one place', () => {
  it('keeps a session per tab, and one closing leaves the other', async () => {
    const db = scoped(MEMBER, ORG)
    await assertSucceeds(
      set(ref(db, `${DOC}/${MEMBER}/${SESSION}`), validEntry('Tab one')),
    )
    await assertSucceeds(
      set(ref(db, `${DOC}/${MEMBER}/${OTHER_SESSION}`), validEntry('Tab two')),
    )

    await assertSucceeds(set(ref(db, `${DOC}/${MEMBER}/${SESSION}`), null))

    const remaining = await assertSucceeds(get(ref(db, `${DOC}/${MEMBER}`)))
    assert.deepEqual(Object.keys(remaining.val() ?? {}), [OTHER_SESSION])
  })

  it('still refuses another person’s session under their uid', async () => {
    await assertFails(
      set(
        ref(scoped(MEMBER, ORG), `${DOC}/${OTHER_MEMBER}/${OTHER_SESSION}`),
        validEntry('Not me'),
      ),
    )
  })

  /** The old flat shape would land a bare entry where a session map belongs. */
  it('refuses an entry written straight onto the uid', async () => {
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}`), validEntry()),
    )
    await assertFails(
      set(ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}`), 'not even an object'),
    )
  })

  it('bounds the session key so it cannot be used as storage', async () => {
    await assertFails(
      set(
        ref(scoped(MEMBER, ORG), `${DOC}/${MEMBER}/${'s'.repeat(60)}`),
        validEntry(),
      ),
    )
  })
})
