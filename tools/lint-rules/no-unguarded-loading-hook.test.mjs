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

// Standalone RuleTester harness (run: `node tools/lint-rules/*.test.mjs`).
// Wired into CI via the `test:eslint-rules` npm script.

import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import rule from './no-unguarded-loading-hook.mjs'

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
})

const err = [{ messageId: 'unguarded' }]

ruleTester.run('no-unguarded-loading-hook', rule, {
  valid: [
    // The flag taken alongside the value — the whole point.
    'const { org, ready } = useCurrentOrg()',
    'const { tokens, loaded } = useScopeTokens(orgId)',
    'const { org, ready } = useOrgPlan()',
    'const { orgWide, ready } = useOrgReach()',
    // Renamed flag. The rule reads the KEY, so an alias is still the flag —
    // which is the shape AGL-1380's fixes actually use.
    'const { org, ready: orgReady } = useCurrentOrg()',
    // Renamed VALUE, flag present. `billing/page.tsx` destructures like this.
    'const { org: orgDoc, orgId, ready } = useCurrentOrg()',
    // `orgId` alone is not unsafe: undefined means "no org in scope", which
    // every caller already handles, and it carries no tier of its own.
    'const { orgId } = useCurrentOrg()',
    'const { orgId, entitlementsFromCache } = useCurrentOrg()',
    // `...rest` puts the flag within reach; the rule cannot tell whether it
    // is consulted, and guessing would be a false positive.
    'const { org, ...rest } = useCurrentOrg()',
    // A computed key could BE the flag — bail rather than misreport.
    'const { org, [flagKey]: flagValue } = useCurrentOrg()',
    // Not a destructuring, so there is nothing to report on.
    'const currentOrg = useCurrentOrg()',
    // An unguarded hook that is not in the guarded set.
    'const { org } = useSomeOtherOrgHook()',
    // Key that is not on the unsafe list.
    'const { entitlementsFromCache } = useCurrentOrg()',
  ],
  invalid: [
    // AGL-1422, the case this file exists for: `org` without `ready`, from
    // the hook the whole console reads. `plan-entitlements` resolves an
    // undefined org to the FREE tier, so this answers "no" before asking.
    { code: 'const { org } = useCurrentOrg()', errors: err },
    // The value renamed does not launder it — `billing/page.tsx`'s shape.
    { code: 'const { org: orgDoc, orgId } = useCurrentOrg()', errors: err },
    // The flag taken under a DIFFERENT hook's name is not this hook's flag.
    { code: 'const { org, loaded } = useCurrentOrg()', errors: err },
    // Inside a component body, which is where every real instance lives.
    {
      code: [
        'function OrgMembersCard() {',
        '  const { org } = useCurrentOrg()',
        "  return checkOrgSeatQuota(org, 'managers', used)",
        '}',
      ].join('\n'),
      errors: err,
    },
    // The three hooks the rule already guarded — kept so a refactor of
    // GUARDED_HOOKS cannot quietly drop one while adding the fourth.
    { code: 'const { tokens } = useScopeTokens(orgId)', errors: err },
    { code: 'const { orgWide } = useScopeTokens(orgId)', errors: err },
    { code: 'const { org } = useOrgPlan()', errors: err },
    { code: 'const { orgWide } = useOrgReach()', errors: err },
  ],
})

console.log('no-unguarded-loading-hook: all RuleTester cases passed')
