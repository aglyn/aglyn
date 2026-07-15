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

// Standalone RuleTester harness (run: `node tools/eslint-rules/*.test.mjs`).
// Wired into CI via the `test:eslint-rules` npm script.

import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import rule from './no-plan-gated-entitlement.mjs'

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
})

const err = [{ messageId: 'noPlanGate' }]

ruleTester.run('no-plan-gated-entitlement', rule, {
  valid: [
    // The correct, unconditional gate.
    "if (!checkEntitlement(org, 'siteExport')) deny()",
    "const cdnAllowed = checkEntitlement(tenant, 'mediaCdn')",
    "if (!checkQuota(org, 'hostLimit', n).allowed) deny()",
    // `plan` used for display/messaging, not coupled to a gate call.
    "const plan = org?.plan; showBadge(plan)",
    "if (org.plan === 'free') { showUpsell() }",
    // Gate calls combined with each other (no plan-presence coupling).
    "const ok = checkEntitlement(org, 'commerce') && checkEntitlement(org, 'pos')",
    // A gate call inside an unrelated inner closure of an `if (plan)` block.
    "if (org.plan) { onClick(() => checkEntitlement(org, 'x')) }",
    // Reading plan then calling a gate in separate statements.
    "const p = tenant['plan']; const q = checkSeatQuota(tenant, 'members', 0)",
  ],
  invalid: [
    // Form A — logical `&&` with negated gate (the videoMedia/siteExport form).
    {
      code: "if (tenant['plan'] && !checkEntitlement(tenant, 'videoMedia')) deny()",
      errors: err,
    },
    // Form A — `!plan || gate` (the mediaCdn form).
    {
      code: "const cdnAllowed = !tenant['plan'] || checkEntitlement(tenant, 'mediaCdn')",
      errors: err,
    },
    // Form A — optional chaining + dot access.
    {
      code: "if (tenant?.plan && !checkEntitlement(tenant, 'siteExport')) deny()",
      errors: err,
    },
    // Form A — member-call gate (`Aglyn.checkEntitlement`).
    {
      code: "if (org['plan'] && !Aglyn.checkEntitlement(org, 'marketplaceSelling')) deny()",
      errors: err,
    },
    // Form A — multi-line condition (publish-template shape).
    {
      code: [
        "if (",
        "  tenant['plan'] &&",
        "  !checkEntitlement(tenant, 'marketplaceSelling')",
        ") { deny() }",
      ].join('\n'),
      errors: err,
    },
    // Form B — block guard wrapping a quota check (hosts/create shape).
    {
      code: "if (tenant?.['plan']) { const q = checkQuota(tenant, 'hostLimit', n); use(q) }",
      errors: err,
    },
    // Form B — block guard wrapping a seat quota (hosts/members shape).
    {
      code: "if (org['plan']) { const q = checkSeatQuota(org, 'members', n); use(q) }",
      errors: err,
    },
  ],
})

console.log('no-plan-gated-entitlement: all RuleTester cases passed')
