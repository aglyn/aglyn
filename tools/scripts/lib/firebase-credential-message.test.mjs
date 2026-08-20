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

// What a self-hoster is told when Firebase refuses their service account
// (AGL-2447).
//
//   npm run test:firebase-credential-message
//
// The three rules-deploy scripts are the FIRST commands the self-hosting
// runbook has an operator run. A wrong service account produced 230 lines of
// GaxiosError — a gzip stream object, a 16 KB byte array, a retry policy — and
// no sentence naming a variable. This tests the classification, which is the
// part that can be wrong, and does it without needing a rejected credential.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { credentialFailureMessage } from './firebase-rules-api.mjs'

const ACCOUNT = {
  projectId: 'operator-demo',
  clientEmail: 'sa@operator-demo.iam.gserviceaccount.com',
}

test('a rejected account names the three variables to check', () => {
  const message = credentialFailureMessage(
    new Error('invalid_grant: Invalid grant: account not found'),
    ACCOUNT,
  )
  assert.match(message, /FIREBASE_PROJECT_ID/)
  assert.match(message, /FIREBASE_CLIENT_EMAIL/)
  assert.match(message, /FIREBASE_PRIVATE_KEY/)
  // The values in play, so the operator can see WHICH project was refused
  // rather than being told to go and check one.
  assert.match(message, /operator-demo/)
  assert.match(message, /sa@operator-demo\.iam\.gserviceaccount\.com/)
})

test('an unparseable key is diagnosed as quoting, not as a wrong account', () => {
  // This is the distinction that earns the classifier its keep: the two
  // failures have completely different fixes, and the raw error for the second
  // one never reaches Google at all.
  const message = credentialFailureMessage(
    new Error('error:1E08010C:DECODER routines::unsupported'),
    ACCOUNT,
  )
  assert.match(message, /could not be parsed/)
  assert.match(message, /QUOTED/)
  assert.doesNotMatch(message, /account does not exist/)
})

test('a permissions failure is not diagnosed as a bad key', () => {
  const message = credentialFailureMessage(
    new Error('Request had insufficient permission: 403 IAM'),
    ACCOUNT,
  )
  assert.match(message, /lacks permission/)
  assert.doesNotMatch(message, /Generate new private key/)
})

test('an unrecognised failure still says what happened, and never guesses', () => {
  const message = credentialFailureMessage(new Error('socket hang up'), ACCOUNT)
  assert.match(message, /underlying error: socket hang up/)
  // No branch claimed: a wrong instruction is worse than none, and this is
  // the case that would otherwise quietly inherit whichever branch is last.
  assert.doesNotMatch(message, /FIREBASE_PRIVATE_KEY/)
  assert.doesNotMatch(message, /lacks permission/)
})

test('the underlying error is always carried, so nothing is hidden', () => {
  for (const raw of [
    'invalid_grant: Invalid grant: account not found',
    'error:1E08010C:DECODER routines::unsupported',
    'Request had insufficient permission: 403 IAM',
    'socket hang up',
  ]) {
    assert.match(credentialFailureMessage(new Error(raw), ACCOUNT), /underlying error: /)
  }
})

test('an empty project or account is reported as empty, not as blank space', () => {
  const message = credentialFailureMessage(new Error('invalid_grant'), {
    projectId: '',
    clientEmail: '',
  })
  assert.match(message, /\(unset\)/)
  assert.match(message, /FIREBASE_CLIENT_EMAIL is empty/)
})
