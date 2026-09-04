/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom.
 *
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
 * ACCOUNT PRE-HIJACKING: WHAT ACTUALLY HAPPENS WHEN GOOGLE SIGNS IN OVER AN
 * UNVERIFIED PASSWORD ACCOUNT (AGL-2590).
 *
 * ## The attack this pins the answer to
 *
 * An attacker signs up with `victim@example.com` and a password they know, and
 * never verifies. The victim later signs in with Google on the same address,
 * which Google has verified. Identity Platform holds ONE account per email
 * address — `allowDuplicateEmails` is unset — so the two must resolve to the
 * same account. If they resolve by LINKING, the attacker's password is now a
 * key to the victim's account. That is the documented pre-hijacking class, and
 * this repository contains no account-linking code of its own: no
 * `account-exists-with-different-credential` handling, no `linkWithCredential`,
 * no `fetchSignInMethodsForEmail`. Whatever happens, happens by default, and
 * nobody here chose it.
 *
 * ## What the default turns out to be
 *
 * Identity Platform performs the standard mitigation itself: it takes the
 * account OVER rather than linking into it. Same `localId`, `emailVerified`
 * true, and the unverified password credential destroyed along with every
 * provider that came with it. The attacker is left with nothing. These cases
 * are what make that a pinned property of the platform we ship on rather than
 * an assumption — a config change (turning on `allowDuplicateEmails`) or a
 * provider that asserts an unverified address would break them loudly instead
 * of quietly reopening the hijack.
 *
 * ## What the repository still owns, and this issue changed
 *
 * The takeover is an AUTH-layer event. It does not touch Firestore, so
 * everything the unverified account wrote survives on the same uid and is
 * inherited by whoever takes the account over. Until AGL-2590 that included a
 * whole WORKSPACE — created at sign-up, named and addressed by the attacker,
 * with the attacker's roster row on it — which the victim would then silently
 * own. Nothing unverified creates a workspace any more, and the one record
 * sign-up still leaves (`users/{uid}.pendingSignUpWorkspace`) names the
 * provider that wrote it and is refused once the account no longer holds it;
 * `signup-workspace-claim.spec.ts` covers that half.
 *
 * ## Residual, and deliberately stated rather than fixed here
 *
 * The takeover bumps `validSince`, which stops the attacker REFRESHING — but
 * an ID token they already hold stays cryptographically valid for the rest of
 * its hour, and case 4 measures exactly that. It does not buy them a console:
 * `/api/auth/session` verifies with `checkRevoked` (AGL-1959) and refuses a
 * token minted before the revocation, so no session cookie can be had with it.
 *
 * Skipped unless FIREBASE_AUTH_EMULATOR_HOST is set — the same convention as
 * the other `*.emulator.spec.ts` files. Start the emulators, then:
 *
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     npx jest -c apps/console/jest.config.ts \
 *       --runTestsByPath \
 *       apps/console/specs/oauth-over-unverified-password.emulator.spec.ts
 */

const EMULATED = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)
const describeEmulated = EMULATED ? describe : describe.skip

const HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'
const ACCOUNTS = `http://${HOST}/identitytoolkit.googleapis.com/v1/accounts`

/** Identity Toolkit, spoken directly — no SDK to interpret the answers. */
async function identityToolkit(
  operation: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${ACCOUNTS}:${operation}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

/**
 * A federated sign-in the emulator will accept.
 *
 * The emulator takes an unsigned JSON claim set in place of the provider's
 * real assertion, which is what makes `email_verified` a knob here — in
 * production it is Google's word, and Google's word is the whole reason the
 * takeover below is allowed to happen at all.
 */
function signInWithGoogle(email: string, emailVerified: boolean, sub: string) {
  return identityToolkit('signInWithIdp', {
    postBody: new URLSearchParams({
      id_token: JSON.stringify({
        sub,
        email,
        email_verified: emailVerified,
        name: 'Real Person',
      }),
      providerId: 'google.com',
    }).toString(),
    requestUri: 'http://localhost',
    returnSecureToken: true,
    returnIdpCredential: true,
  })
}

/**
 * A fresh address and a fresh provider identity, per case.
 *
 * The `sub` has to be unique too, and that is not tidiness. The emulator
 * resolves a federated sign-in by PROVIDER IDENTITY first and only then by
 * email, so re-running this file against an emulator that kept its state would
 * match the previous run's Google account and never reach the branch every
 * case here is about.
 */
const identity = (label: string) => {
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  return { email: `${label}-${nonce}@example.com`, sub: `${label}-${nonce}` }
}

describeEmulated('AGL-2590 · OAuth over an unverified password account', () => {
  it('the platform is configured for ONE account per address', async () => {
    // The premise of everything below. With duplicates allowed, Google would
    // make a SECOND account and the attacker's would sit beside it holding the
    // address — a different problem, and one none of these cases would catch.
    const config = await (
      await fetch(`http://${HOST}/emulator/v1/projects/aglyn-main/config`)
    ).json()
    expect(config.signIn.allowDuplicateEmails).toBe(false)
  })

  it('TAKES THE ACCOUNT OVER and destroys the unverified password', async () => {
    const { email, sub } = identity('victim')
    const signUp = await identityToolkit('signUp', {
      email,
      password: 'AttackerKnows123!',
      returnSecureToken: true,
    })
    expect(signUp.status).toBe(200)
    const attackerUid = signUp.body.localId

    const before = await identityToolkit('lookup', {
      idToken: signUp.body.idToken,
    })
    expect(before.body.users[0].emailVerified).toBe(false)
    expect(
      before.body.users[0].providerUserInfo.map((p: any) => p.providerId),
    ).toEqual(['password'])

    const google = await signInWithGoogle(email, true, sub)
    expect(google.status).toBe(200)
    // The same account, not a second one — this is the linking moment.
    expect(google.body.localId).toBe(attackerUid)
    expect(google.body.emailVerified).toBe(true)

    // THE MITIGATION. If this ever comes back 200, the attacker's password is
    // a key to the victim's account and the hijack is live.
    const asAttacker = await identityToolkit('signInWithPassword', {
      email,
      password: 'AttackerKnows123!',
      returnSecureToken: true,
    })
    expect(asAttacker.status).toBe(400)
    expect(asAttacker.body.error.message).toBe('INVALID_PASSWORD')

    const after = await identityToolkit('lookup', {
      idToken: google.body.idToken,
    })
    expect(
      after.body.users[0].providerUserInfo.map((p: any) => p.providerId),
    ).toEqual(['google.com'])
    expect(after.body.users[0].passwordHash).toBeUndefined()
  })

  it('leaves a VERIFIED password account alone — that one is a real link', async () => {
    // The control. The takeover above is licensed by the password credential
    // being unproven; an owner who verified keeps their password when they
    // later add Google, which is ordinary account linking and must not regress
    // into a credential being deleted out from under somebody.
    const { email, sub } = identity('owner')
    const signUp = await identityToolkit('signUp', {
      email,
      password: 'OwnerPassword123!',
      returnSecureToken: true,
    })
    await identityToolkit('sendOobCode', {
      requestType: 'VERIFY_EMAIL',
      idToken: signUp.body.idToken,
    })
    const { oobCodes } = await (
      await fetch(`http://${HOST}/emulator/v1/projects/aglyn-main/oobCodes`)
    ).json()
    const code = oobCodes.filter((entry: any) => entry.email === email).pop()
    await identityToolkit('update', { oobCode: code.oobCode })

    const google = await signInWithGoogle(email, true, sub)
    expect(google.body.localId).toBe(signUp.body.localId)
    const asOwner = await identityToolkit('signInWithPassword', {
      email,
      password: 'OwnerPassword123!',
      returnSecureToken: true,
    })
    expect(asOwner.status).toBe(200)
  })

  it('refuses to link an IdP that asserts an UNVERIFIED address', async () => {
    // The other half of the licence. A provider that has not proved the
    // address gets `needConfirmation` and NO token — the SDK surfaces this as
    // `auth/account-exists-with-different-credential`. Nothing is linked,
    // nothing is destroyed, and neither party has taken the other's account.
    const { email, sub } = identity('unproven')
    const signUp = await identityToolkit('signUp', {
      email,
      password: 'AttackerKnows123!',
      returnSecureToken: true,
    })
    const idp = await signInWithGoogle(email, false, sub)
    expect(idp.body.needConfirmation).toBe(true)
    expect(idp.body.idToken).toBeUndefined()
    const stillTheirs = await identityToolkit('signInWithPassword', {
      email,
      password: 'AttackerKnows123!',
      returnSecureToken: true,
    })
    expect(stillTheirs.status).toBe(200)
    expect(stillTheirs.body.localId).toBe(signUp.body.localId)
  })

  it('RESIDUAL: an ID token the attacker already holds outlives the takeover', async () => {
    // Stated, not fixed. `validSince` moves, so nothing can be REFRESHED — but
    // a token already minted stays valid for the rest of its hour. It buys no
    // console: `/api/auth/session` verifies with `checkRevoked` (AGL-1959) and
    // refuses to mint a cookie from a token older than the revocation. This
    // case exists so the residual is measured rather than assumed away.
    const { email, sub } = identity('residual')
    const signUp = await identityToolkit('signUp', {
      email,
      password: 'AttackerKnows123!',
      returnSecureToken: true,
    })
    await signInWithGoogle(email, true, sub)
    const stale = await identityToolkit('lookup', {
      idToken: signUp.body.idToken,
    })
    expect(stale.status).toBe(200)
    // And it now describes the account the VICTIM owns, which is the shape of
    // the risk: the uid did not change, only who can obtain new tokens for it.
    expect(stale.body.users[0].localId).toBe(signUp.body.localId)
    expect(stale.body.users[0].emailVerified).toBe(true)
  })
})
