/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * The native apps' sign-up says what the console's says (AGL-3819).
 *
 * The Aglyn and Aglyn POS apps create accounts through the console's own
 * routes, in the console's order, and the values those routes read cannot be
 * generated into the apps: the modules that own them (plan entitlements, the
 * marketing-consent wording, the host-naming blocklist) reach code the native
 * isolation check refuses. So each app carries its copy, and this sweep holds
 * both copies to the console's:
 *
 * - the marketing opt-in's wording version, which the consent route refuses a
 *   decision under any other value of, and its sentence;
 * - the source the opt-in is recorded under, which the route allowlists;
 * - the acquisition door a Google sign-up names, which the route allowlists;
 * - the plan labels and self-serve plans a sign-up link's `?plan=` is read
 *   against, and the three campaign keys;
 * - the workspace address blocklist the organization-name rule checks;
 * - the `users/{uid}` fields the sign-up writes and the first verified
 *   session reads.
 *
 * The literals are matched in the Swift and Kotlin sources as quoted strings,
 * so a value changed on one side and not the other reds here.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACQUISITION_DOORS,
} from '@aglyn/aglyn/app-utils/account-acquisition'
import {
  PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
  PLATFORM_MARKETING_CONSOLE_SOURCE_KINDS,
  platformMarketingConsentText,
} from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import { PLAN_LABELS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { RESERVED_SUBDOMAINS } from '@aglyn/aglyn/app-utils/host-naming'
import { UTM_QUERY_KEYS } from '@aglyn/aglyn/app-utils/utm-attribution'
import { parseOnboardingPlanIntent } from '@aglyn/aglyn/app-utils/onboarding-deep-link'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const NATIVE = {
  swift: read('libs/native/apple/Sources/AglynCore/SignUp.swift'),
  kotlin: read('libs/native/kotlin/core/src/commonMain/kotlin/com/aglyn/core/SignUp.kt'),
}

/** A set literal from the host-naming source, for the lists it does not export. */
function sourceList(name: string): string[] {
  const source = read('libs/aglyn/src/lib/app-utils/host-naming.ts') + read('libs/aglyn/src/lib/app-utils/organizations.ts')
  const match = new RegExp(`const ${name}\\s*=\\s*(?:new Set\\()?\\[([^\\]]*)\\]`).exec(source)
  if (!match) throw new Error(`${name} is not a list literal any more; update this sweep`)
  return Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1])
}

describe.each(Object.entries(NATIVE))('the %s sign-up', (_platform, source) => {
  const quoted = (value: string) => source.includes(`"${value}"`)

  it('records the opt-in under the wording version and source the consent route accepts', () => {
    expect(quoted(PLATFORM_MARKETING_CONSENT_TEXT_VERSION)).toBe(true)
    expect(PLATFORM_MARKETING_CONSOLE_SOURCE_KINDS).toContain('console-signup')
    expect(quoted('console-signup')).toBe(true)
    // The sentence, with the brand left for the app to fill.
    const [before, after] = platformMarketingConsentText('\u0000').split('\u0000')
    expect(source).toContain(before)
    expect(source).toContain(after)
  })

  it('names only acquisition doors the route allowlists', () => {
    expect(ACQUISITION_DOORS).toContain('signup-google')
    expect(quoted('signup-google')).toBe(true)
    expect(quoted('signup-password')).toBe(true)
  })

  it('reads a sign-up link’s plan against the console’s plans and labels', () => {
    for (const [plan, label] of Object.entries(PLAN_LABELS)) {
      expect(quoted(plan)).toBe(true)
      expect(quoted(label)).toBe(true)
    }
    for (const plan of ['starter', 'pro', 'business', 'scale', 'advanced', 'agency']) {
      expect(parseOnboardingPlanIntent(new URLSearchParams({ plan }))?.contactSales).toBe(false)
    }
    expect(parseOnboardingPlanIntent(new URLSearchParams({ plan: 'free' }))).toBeNull()
    for (const key of UTM_QUERY_KEYS) expect(quoted(key)).toBe(true)
  })

  it('refuses the workspace addresses the console reserves', () => {
    for (const word of [...RESERVED_SUBDOMAINS, ...sourceList('RESERVED_ORG_ONLY'), ...sourceList('BLOCKED_FRAGMENTS')]) {
      expect(quoted(word)).toBe(true)
    }
  })

  it('writes and reads the account fields the console’s sign-up and chooser use', () => {
    for (const field of ['pendingSignUpWorkspace', 'onboardingPlanIntent', 'signupCampaign', 'firstName', 'lastName']) {
      expect(source.includes(field)).toBe(true)
    }
    expect(quoted('password')).toBe(true)
  })
})
