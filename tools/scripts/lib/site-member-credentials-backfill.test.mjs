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

// The site-member credential migration's decisions (AGL-3308).
//
//   node --test tools/scripts/lib/site-member-credentials-backfill.test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CREDENTIAL_FIELDS,
  planMemberCredentials,
  planSiteCredentials,
  rulesDenyCredentials,
  signInReadsCredentials,
} from './site-member-credentials-backfill.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (path) => readFileSync(join(REPO_ROOT, path), 'utf8')

const HASH = `${'a'.repeat(32)}:${'b'.repeat(128)}`
const NEWER = `${'c'.repeat(32)}:${'d'.repeat(128)}`
const RESET_AT = { seconds: 1_790_000_000, nanoseconds: 0 }

/** The documents after a plan is applied, the way the script writes them. */
function apply({ profile, credential }, plan) {
  const nextProfile = { ...profile }
  for (const field of plan.strip) delete nextProfile[field]
  const nextCredential = plan.credentialPatch
    ? { ...(credential ?? {}), ...plan.credentialPatch }
    : credential
  return { profile: nextProfile, credential: nextCredential }
}

describe('what one member needs', () => {
  it('owns exactly the two credential fields', () => {
    assert.deepEqual(CREDENTIAL_FIELDS, ['passwordScrypt', 'passwordResetAt'])
  })

  it('leaves a profile with no credential field alone, whatever else it holds', () => {
    assert.equal(
      planMemberCredentials({
        profile: { email: 'a@b.test', displayName: 'A', suspended: true, sessionsValidFromMs: 5 },
        credential: { passwordScrypt: HASH },
      }),
      null,
    )
    assert.equal(planMemberCredentials({ profile: {}, credential: null }), null)
    assert.equal(planMemberCredentials({ profile: undefined, credential: undefined }), null)
  })

  it('moves a legacy hash VERBATIM and deletes it from the profile', () => {
    // Verbatim is what keeps a reset link minted before the move working: the
    // token is bound to a fingerprint of this exact string.
    const plan = planMemberCredentials({
      profile: { email: 'a@b.test', passwordScrypt: HASH },
      credential: null,
    })
    assert.deepEqual(plan, {
      outcome: 'moved',
      credentialPatch: { passwordScrypt: HASH },
      strip: ['passwordScrypt'],
    })
    assert.equal(plan.credentialPatch.passwordScrypt, HASH)
  })

  it('carries the reset time with the hash', () => {
    assert.deepEqual(
      planMemberCredentials({
        profile: { passwordScrypt: HASH, passwordResetAt: RESET_AT },
        credential: null,
      }),
      {
        outcome: 'moved',
        credentialPatch: { passwordScrypt: HASH, passwordResetAt: RESET_AT },
        strip: ['passwordScrypt', 'passwordResetAt'],
      },
    )
  })

  it('keeps a reset time the credential document already has', () => {
    const own = { seconds: 1_799_000_000, nanoseconds: 0 }
    assert.deepEqual(
      planMemberCredentials({
        profile: { passwordScrypt: HASH, passwordResetAt: RESET_AT },
        credential: { passwordResetAt: own },
      }),
      {
        outcome: 'moved',
        credentialPatch: { passwordScrypt: HASH },
        strip: ['passwordScrypt', 'passwordResetAt'],
      },
    )
  })

  it('never copies a legacy hash over one a live route already wrote', () => {
    // A member who reset their password after the promotion has the NEW hash
    // on the credential document. Copying the profile's old one across would
    // quietly give them back the password they just replaced.
    assert.deepEqual(
      planMemberCredentials({
        profile: { passwordScrypt: HASH, passwordResetAt: RESET_AT },
        credential: { passwordScrypt: NEWER },
      }),
      {
        outcome: 'superseded',
        credentialPatch: null,
        strip: ['passwordScrypt', 'passwordResetAt'],
      },
    )
  })

  it('strips a credential field that holds no usable hash, and copies nothing', () => {
    for (const profile of [
      { passwordScrypt: '' },
      { passwordScrypt: 42 },
      { passwordScrypt: null },
      { passwordResetAt: RESET_AT },
    ]) {
      const plan = planMemberCredentials({ profile, credential: null })
      assert.equal(plan.outcome, 'stripped', JSON.stringify(profile))
      assert.equal(plan.credentialPatch, null)
      assert.deepEqual(plan.strip, Object.keys(profile))
    }
  })

  it('plans nothing on a second run — every outcome converges', () => {
    for (const before of [
      { profile: { email: 'a@b.test', passwordScrypt: HASH }, credential: null },
      {
        profile: { passwordScrypt: HASH, passwordResetAt: RESET_AT },
        credential: { passwordScrypt: NEWER },
      },
      { profile: { passwordScrypt: '' }, credential: null },
    ]) {
      const after = apply(before, planMemberCredentials(before))
      assert.equal(planMemberCredentials(after), null)
      for (const field of CREDENTIAL_FIELDS) {
        assert.equal(field in after.profile, false, field)
      }
    }
  })
})

describe('one site', () => {
  it('counts each outcome and plans a write only for members that need one', () => {
    const { writes, counts } = planSiteCredentials({
      members: [
        { id: 'clean', data: {} },
        { id: 'legacy', data: { passwordScrypt: HASH } },
        { id: 'raced', data: { passwordScrypt: HASH } },
        { id: 'junk', data: { passwordScrypt: '' } },
      ],
      credentials: new Map([['raced', { passwordScrypt: NEWER }]]),
    })
    assert.deepEqual(counts, { read: 4, clean: 1, moved: 1, superseded: 1, stripped: 1 })
    assert.deepEqual(
      writes.map((write) => [write.id, write.outcome]),
      [
        ['legacy', 'moved'],
        ['raced', 'superseded'],
        ['junk', 'stripped'],
      ],
    )
  })
})

describe('the tree guard that refuses --apply on an older checkout', () => {
  it('passes on this checkout', () => {
    assert.equal(
      signInReadsCredentials({
        loginSource: read('libs/plugins/commerce/src/lib/server/membership-login.ts'),
        helperSource: read('libs/plugins/commerce/src/lib/server/member-credentials.ts'),
      }),
      true,
    )
    assert.equal(rulesDenyCredentials(read('cloud/firebase-firestore.rules')), true)
  })

  it('refuses a login route that still reads the profile alone', () => {
    const before = [
      "if (!memberDoc || !verifyMemberPassword(password, memberDoc.get('passwordScrypt'))) {",
      '  // readMemberPasswordHash(hostRef, memberDoc) would be the fix',
      '}',
    ].join('\n')
    assert.equal(
      signInReadsCredentials({
        loginSource: before,
        helperSource: read('libs/plugins/commerce/src/lib/server/member-credentials.ts'),
      }),
      false,
    )
  })

  it('refuses rules that leave the credential collection or a profile hash writable', () => {
    const rules = read('cloud/firebase-firestore.rules')
    // The catch-all as it stood before AGL-3308: staff and members through.
    const unguarded = rules.replaceAll(
      "subcollection != 'siteMemberCredentials' && (isStaff() ||",
      '(isStaff() ||',
    )
    assert.notEqual(unguarded, rules)
    assert.equal(rulesDenyCredentials(unguarded), false)
    // One statement unguarded is enough to refuse.
    const oneOpen = rules.replace(
      "allow delete: if subcollection != 'siteMemberCredentials' && (isStaff() ||",
      'allow delete: if (isStaff() ||',
    )
    assert.notEqual(oneOpen, rules)
    assert.equal(rulesDenyCredentials(oneOpen), false)
    // A profile update no longer narrowed to the suspend flag.
    const wide = rules.replace(".hasOnly(['suspended'])", ".hasOnly(['suspended', 'passwordScrypt'])")
    assert.notEqual(wide, rules)
    assert.equal(rulesDenyCredentials(wide), false)
  })
})
