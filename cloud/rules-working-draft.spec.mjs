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
 * THE WORKING DRAFT'S RULES (AGL-1152).
 *
 * The draft needed its own rule because the recursive matcher under a screen
 * allows `create` only to staff — so an author's FIRST draft save, the one
 * that brings the document into existence, was refused while every save after
 * it would have succeeded. Rules are OR'd across matching paths, which is what
 * makes a narrow addition able to grant that without loosening anything else.
 *
 * "Without loosening anything else" is the part a compile check cannot prove,
 * so it is asserted here: an author must still be unable to create a version,
 * delete one, or move the live pointer. A rules file that merely PARSES is not
 * a rules file that is safe.
 */
import { readFileSync } from 'node:fs'

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'

const AUTHOR = 'QQ7fixtureAuthor00000000000001'
const OUTSIDER = 'QQ7fixtureOutsider0000000000001'
const HOST = 'DXnRbPH4CQ'
const SCREEN = 'v0clP6xQl-'
const VERSION = 'rjRIsYMn9Y'
const DRAFT = ['hosts', HOST, 'screens', SCREEN, 'versions', VERSION, 'draft', 'current']

const env = await initializeTestEnvironment({
  projectId: 'aglyn-main',
  firestore: {
    host: '127.0.0.1',
    port: 8082,
    rules: readFileSync('cloud/firebase-firestore.rules', 'utf8'),
  },
})

const results = []
const check = async (label, fn) => {
  try {
    await fn()
    results.push(['PASS', label])
  } catch (error) {
    results.push(['FAIL', label, String(error).slice(0, 160)])
  }
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  // `author` is the edit-but-never-publish role, and so the sharpest subject:
  // if the draft works for an author it works for every writing role above.
  await setDoc(doc(db, 'hosts', HOST), {
    subdomain: 'aglyn-marketing',
    memberRoles: { [AUTHOR]: 'author' },
    screens: {},
  })
  await setDoc(doc(db, 'hosts', HOST, 'screens', SCREEN), { versionId: VERSION })
  await setDoc(
    doc(db, 'hosts', HOST, 'screens', SCREEN, 'versions', VERSION),
    { nodes: {} },
  )
})

const author = env.authenticatedContext(AUTHOR, { email_verified: true })
const outsider = env.authenticatedContext(OUTSIDER, { email_verified: true })
const db = author.firestore()

// The control. If this fails the fixture is wrong and nothing below means
// anything.
await check('CONTROL — an author reads the screen it may edit', () =>
  assertSucceeds(getDoc(doc(db, 'hosts', HOST, 'screens', SCREEN))),
)

await check('an author CREATES the working draft (the first save)', () =>
  assertSucceeds(setDoc(doc(db, ...DRAFT), { nodes: {}, baseStamp: null })),
)
await check('an author UPDATES the working draft (every save after)', () =>
  assertSucceeds(setDoc(doc(db, ...DRAFT), { nodes: { a: 1 }, baseStamp: null })),
)
await check('an author READS the working draft (a colleague opens it)', () =>
  assertSucceeds(getDoc(doc(db, ...DRAFT))),
)

// NEGATIVES — the reason this file exists. Each is something the recursive
// matcher refused before, and must still refuse.
await check('NEGATIVE — an author cannot CREATE a version', () =>
  assertFails(
    setDoc(doc(db, 'hosts', HOST, 'screens', SCREEN, 'versions', 'forged'), {
      nodes: {},
    }),
  ),
)
await check('NEGATIVE — an author cannot DELETE a version', () =>
  assertFails(
    deleteDoc(doc(db, 'hosts', HOST, 'screens', SCREEN, 'versions', VERSION)),
  ),
)
await check('NEGATIVE — an author cannot move the live pointer', () =>
  assertFails(
    setDoc(
      doc(db, 'hosts', HOST, 'screens', SCREEN),
      { versionId: 'somethingElse' },
      { merge: true },
    ),
  ),
)
await check('NEGATIVE — a non-member cannot read the working draft', () =>
  assertFails(getDoc(doc(outsider.firestore(), ...DRAFT))),
)
await check('NEGATIVE — a non-member cannot write the working draft', () =>
  assertFails(setDoc(doc(outsider.firestore(), ...DRAFT), { nodes: {} })),
)

// Publishing clears it, so the writing role must be able to remove it.
await check('an author DELETES the working draft (publish clears it)', () =>
  assertSucceeds(deleteDoc(doc(db, ...DRAFT))),
)

await env.cleanup()

for (const [status, label, detail] of results) {
  console.log(
    `${status === 'PASS' ? '  ok  ' : ' FAIL '} ${label}${detail ? `\n        ${detail}` : ''}`,
  )
}
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
