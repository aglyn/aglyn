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
// The invalid cases are the four real incidents verbatim — AGL-949's
// `await import('@aglyn/aglyn/server')`, AGL-1329's deferred
// `@aglyn/tenant-data-admin`, the `jest.isolateModules` re-require, and
// AGL-2282/AGL-2313's `jest.mock` factory `require` that cost 441 console
// errors. They stay here now that all four files are fixed: the point of a
// regression case is that it keeps failing after the code stops.
//
// The valid cases are the things in this repo that LOOK like the violation and
// are not it — the 97 `jest.requireActual('@aglyn/…')` call sites, the
// deliberate `reRequire` indirection in `email-media-src-drift.spec.ts`, the
// product-code `lazy()` boundaries that are supposed to be dynamic, and
// relative deferred imports, which never leave the project and so never create
// a cross-project edge. If the rule ever starts reporting any of those it is
// conflating "deferred" with "deferred ACROSS A PROJECT BOUNDARY, from a file
// that is not shipped", and the next person will switch it off rather than
// argue with it.

import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import rule from './no-dynamic-first-party-import.mjs'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const SPEC = '/repo/libs/plugins/marketplace/src/lib/server/thing.spec.ts'
const PRODUCT = '/repo/apps/console/constants/plugins.client.generated.ts'
const INSTRUMENTATION = '/repo/apps/console/instrumentation.ts'

const deferred = (specifier) => ({
  messageId: 'deferredFirstParty',
  data: { specifier },
})

const deferredInstrumentation = (specifier) => ({
  messageId: 'deferredFirstPartyInstrumentation',
  data: { specifier },
})

ruleTester.run('no-dynamic-first-party-import', rule, {
  valid: [
    // The ordinary way to reach another library from a spec.
    {
      filename: SPEC,
      code: `import { PUBLISHER_AGREEMENT_VERSION } from '@aglyn/aglyn/app-utils/publisher-agreement'`,
    },
    // jest's mock-registry API. 97 call sites; nx records no edge for these.
    {
      filename: SPEC,
      code: `const actual = jest.requireActual('@aglyn/aglyn')`,
    },
    {
      filename: SPEC,
      code: `const mocked = jest.requireMock('@aglyn/tenant-data-admin')`,
    },
    // The documented escape hatch: a non-literal specifier, which is what nx
    // reads, so neither nx nor this rule sees a dependency.
    {
      filename: SPEC,
      code: `jest.isolateModules(() => { const m = reRequire('@aglyn/aglyn'); void m })`,
    },
    // Relative deferred imports never cross a project boundary.
    {
      filename: SPEC,
      code: `it('x', async () => { const m = await import('./campaign-send'); void m })`,
    },
    {
      filename: SPEC,
      code: `jest.mock('./publisher-profile', () => ({ v: require('./agreement') }))`,
    },
    // Third-party packages are not ours to keep static.
    {
      filename: SPEC,
      code: `it('x', async () => { await import('firebase-admin') })`,
    },
    // AGL-1921's FIX shape: the deferral stays (it is what keeps
    // firebase-admin out of the edge bundle) and the specifier is relative,
    // so nx records no cross-project edge. Both apps ship exactly this.
    {
      filename: INSTRUMENTATION,
      code: `export async function onRequestError() { const { reportServerError } = await import('./utils/report-server-error'); void reportServerError }`,
    },
    {
      filename: '/repo/apps/tenant/instrumentation.ts',
      code: `export async function register() { const { warmFirestoreAtBoot } = await import('./utils/boot-warmup'); warmFirestoreAtBoot() }`,
    },
    // A STATIC lib import in instrumentation.ts is not this rule's business —
    // it creates no lazy edge. Only the deferred form is reported.
    {
      filename: INSTRUMENTATION,
      code: `import { reportServerError } from '@aglyn/tenant-data-admin'
export const f = () => reportServerError`,
    },
    // Third-party deferrals in instrumentation.ts stay legal: nx has no edge
    // to record, and `@vercel/otel`-shaped imports belong exactly here.
    {
      filename: INSTRUMENTATION,
      code: `export async function register() { await import('firebase-admin') }`,
    },
    // The basename anchor: a helper whose NAME merely starts with
    // `instrumentation` is ordinary product code, and a deferred lib import
    // there may well be a real code-split boundary.
    {
      filename: '/repo/apps/console/utils/instrumentation-helpers.ts',
      code: `export const load = () => import('@aglyn/tenant-data-admin')`,
    },
    // PRODUCT code: the generated loader manifests and the `lazy()` pages are
    // real code-split boundaries and must stay deferred.
    {
      filename: PRODUCT,
      code: `export const load = () => import('@aglyn/plugins-marketplace')`,
    },
    {
      filename: '/repo/apps/console/app/(editor)/besigner/page.tsx',
      code: `const D = lazy(() => import('@aglyn/besigner-feature-designer'))`,
    },
  ],

  invalid: [
    // AGL-2282 / AGL-2313 verbatim: 441 errors across 364 console files.
    {
      filename: SPEC,
      code: `jest.mock('./publisher-profile', () => ({
  __agreement: {
    version: (require('@aglyn/aglyn/app-utils/publisher-agreement') as {
      PUBLISHER_AGREEMENT_VERSION: string
    }).PUBLISHER_AGREEMENT_VERSION,
  },
}))`,
      errors: [deferred('@aglyn/aglyn/app-utils/publisher-agreement')],
    },
    // AGL-949 verbatim.
    {
      filename: SPEC,
      code: `it('x', async () => { const s = await import('@aglyn/aglyn/server'); void s })`,
      errors: [deferred('@aglyn/aglyn/server')],
    },
    // AGL-1329 verbatim.
    {
      filename: '/repo/libs/tenant/runtime/src/lib/takedown.emulator.spec.ts',
      code: `beforeAll(async () => { admin = await import('@aglyn/tenant-data-admin') })`,
      errors: [deferred('@aglyn/tenant-data-admin')],
    },
    // The `email-media-src-drift.spec.ts` shape, before the indirection.
    {
      filename: '/repo/apps/console/specs/drift.spec.ts',
      code: `jest.isolateModules(() => { const m = require('@aglyn/aglyn'); void m })`,
      errors: [deferred('@aglyn/aglyn')],
    },
    // `campaign-preview.spec.ts` — safe today ONLY because the method chain
    // puts it on the benign side of nx's heuristic. Reported anyway: that is
    // the whole point, a refactor away from being 400 errors.
    {
      filename: '/repo/libs/plugins/marketing/src/lib/server/preview.spec.ts',
      code: `it('x', () => { jest.spyOn(require('@aglyn/tenant-data-admin'), 'f').mockResolvedValue(1) })`,
      errors: [deferred('@aglyn/tenant-data-admin')],
    },
    // AGL-1921 verbatim: 222 errors on the gate (181 console, 41 tenant),
    // and the reason this rule no longer stops at spec files. The deferral is
    // legitimate; the LIB SPECIFIER is what costs the workspace the edge.
    {
      filename: INSTRUMENTATION,
      code: `export async function onRequestError() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { reportServerError } = await import('@aglyn/tenant-data-admin')
  void reportServerError
}`,
      errors: [deferredInstrumentation('@aglyn/tenant-data-admin')],
    },
    {
      filename: '/repo/apps/tenant/instrumentation.ts',
      code: `export async function register() { const m = await import('@aglyn/tenant-data-admin'); void m }`,
      errors: [deferredInstrumentation('@aglyn/tenant-data-admin')],
    },
    // The `require` form is caught in instrumentation.ts too.
    {
      filename: INSTRUMENTATION,
      code: `export const f = () => { const m = require('@aglyn/aglyn/server'); return m }`,
      errors: [deferredInstrumentation('@aglyn/aglyn/server')],
    },
    // A spec named `instrumentation-*.spec.ts` is still caught by the SPEC
    // arm, and reports the spec message — the basename anchor must not turn
    // the instrumentation arm into an escape hatch for specs.
    {
      filename: '/repo/apps/tenant/specs/instrumentation-boot-warmup.spec.ts',
      code: `it('x', async () => { await import('@aglyn/tenant-data-admin') })`,
      errors: [deferred('@aglyn/tenant-data-admin')],
    },
    // Two on one line still report twice — the blast radius is per edge.
    {
      filename: SPEC,
      code: `it('x', async () => { await import('@aglyn/aglyn'); await import('@aglyn/shared-util-logger') })`,
      errors: [deferred('@aglyn/aglyn'), deferred('@aglyn/shared-util-logger')],
    },
  ],
})

console.log('no-dynamic-first-party-import: all RuleTester cases passed')
