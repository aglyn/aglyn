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

// Standalone RuleTester harness (run: `npm run test:eslint-rules`).
//
// Unlike the other local rules, this one is not purely syntactic: the verdict
// depends on where the file sits in the real workspace import graph. So the
// cases carry REAL filenames and the rule answers from the real graph — which
// is the point, since the bug it guards is a property of the graph and of
// nothing visible in the file.
//
// The invalid cases are the AGL-1349 negative control in miniature: the exact
// import that took `main` down, at the exact file that wrote it.

import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import rule from './no-cross-graph-import.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

/** The dual-graph module at the centre of AGL-1349. */
const DUAL = join(ROOT, 'apps/console/utils/usage-metering.ts')
/** One of the three App Routes that reach it. */
const ROUTE = join(ROOT, 'apps/console/app/api/billing/usage-alerts/route.ts')
/** The Billing card — a `'use client'` component. */
const CLIENT = join(
  ROOT,
  'apps/console/components/billing/billing-metered-estimate.component.tsx',
)

ruleTester.run('no-cross-graph-import', rule, {
  valid: [
    // The shipped fix: the modules underneath, safe in both graphs.
    {
      filename: DUAL,
      code: "import { resolveOrgEntitlements } from '@aglyn/aglyn/app-utils/plan-entitlements'",
    },
    // `import type` is erased, so it is not a graph edge at all — which is
    // why the fix could keep the type import.
    {
      filename: DUAL,
      code: "import type { AglynOrgBilling } from '@aglyn/aglyn'",
    },
    {
      filename: DUAL,
      code: "import { type AglynOrgBilling } from '@aglyn/aglyn'",
    },
    // The server barrel is correct in a route…
    {
      filename: ROUTE,
      code: "import { pluginRequestFromWeb } from '@aglyn/aglyn/server'",
    },
    // …and the client barrel is correct in a client component.
    {
      filename: CLIENT,
      code: "'use client'\nimport { useSiteContext } from '@aglyn/aglyn'",
    },
    // A module outside both graphs is nobody's business.
    {
      filename: join(ROOT, 'tools/scripts/whatever.ts'),
      code: "import { anything } from '@aglyn/aglyn'",
    },
  ],
  invalid: [
    // AGL-1349 exactly: the client barrel in the dual-graph module.
    {
      filename: DUAL,
      code: "import { planMetersInfraOverage } from '@aglyn/aglyn'",
      errors: [{ messageId: 'dualGraph' }],
    },
    // The same mistake made directly in the App Route.
    {
      filename: ROUTE,
      code: "import { planMetersInfraOverage } from '@aglyn/aglyn'",
      errors: [{ messageId: 'clientIntoServer' }],
    },
    // A re-export carries the graph edge just as an import does.
    {
      filename: ROUTE,
      code: "export { planMetersInfraOverage } from '@aglyn/aglyn'",
      errors: [{ messageId: 'clientIntoServer' }],
    },
    // The other direction, which bit the AGL-1349 fix too: the `/server`
    // entry drags `node:stream` into the browser bundle.
    {
      filename: CLIENT,
      code: "'use client'\nimport { pluginRequestFromWeb } from '@aglyn/aglyn/server'",
      errors: [{ messageId: 'serverIntoClient' }],
    },
    // And in the dual-graph module, where NEITHER barrel is legal.
    {
      filename: DUAL,
      code: "import { pluginRequestFromWeb } from '@aglyn/aglyn/server'",
      errors: [{ messageId: 'dualGraph' }],
    },
  ],
})

console.log('no-cross-graph-import: all RuleTester cases passed')
