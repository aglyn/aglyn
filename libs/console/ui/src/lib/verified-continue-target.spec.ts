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
 * AGL-1730 — where a just-verified account lands.
 *
 * The caller HARD-navigates the answer, so the interesting cases are the ones
 * that must come back null: an off-site value would be an open redirect, and a
 * value pointing back at the auth wall is a loop the user cannot leave.
 */

import { verifiedContinueTarget } from './verified-continue-target'

// The shared predicate reads the workspace domain from the environment at
// module load, so derive the same-site host rather than hard-coding a domain
// a leaked .env could change underneath this file.
const workspaceHost = `acme.${
  process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'
}`

describe('verifiedContinueTarget', () => {
  it('keeps a same-app path, query and fragment intact', () => {
    expect(verifiedContinueTarget('/acme/billing?plan=pro#seats')).toBe(
      '/acme/billing?plan=pro#seats',
    )
  })

  it('keeps a same-site absolute workspace return (AGL-465)', () => {
    expect(verifiedContinueTarget(`https://${workspaceHost}/pages`)).toBe(
      `https://${workspaceHost}/pages`,
    )
  })

  it('is null with no continue at all', () => {
    expect(verifiedContinueTarget('')).toBeNull()
    expect(verifiedContinueTarget(null)).toBeNull()
    expect(verifiedContinueTarget(undefined)).toBeNull()
  })

  it('is null for anything off-site', () => {
    expect(verifiedContinueTarget('https://evil.example.com/harvest')).toBeNull()
    expect(verifiedContinueTarget('//evil.example.com')).toBeNull()
    expect(verifiedContinueTarget(`http://${workspaceHost}`)).toBeNull()
    expect(verifiedContinueTarget('javascript:alert(1)')).toBeNull()
    expect(verifiedContinueTarget('acme/billing')).toBeNull()
  })

  it('is null for the auth wall itself — that is a redirect loop', () => {
    expect(
      verifiedContinueTarget('/verify-email?continue=%2Fverify-email'),
    ).toBeNull()
    expect(verifiedContinueTarget('/signin')).toBeNull()
    expect(verifiedContinueTarget('/signup?plan=pro')).toBeNull()
    expect(verifiedContinueTarget('/sso/callback')).toBeNull()
    expect(verifiedContinueTarget('/reset-password')).toBeNull()
    expect(verifiedContinueTarget('/account-recovery')).toBeNull()
  })

  it('is null for /signout — verifying then signing straight back out', () => {
    expect(verifiedContinueTarget('/signout')).toBeNull()
    expect(verifiedContinueTarget(`https://${workspaceHost}/signout`)).toBeNull()
  })

  it('does not mistake a real page for an auth route by prefix', () => {
    // `/signout-survey` is not `/signout`; the check is segment-aware.
    expect(verifiedContinueTarget('/signup-complete')).toBe('/signup-complete')
    expect(verifiedContinueTarget('/acme/signin-logs')).toBe(
      '/acme/signin-logs',
    )
  })
})
