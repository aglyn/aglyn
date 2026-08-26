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
 * THE FEATURE MATRIX, GENERATED (AGL-1152).
 *
 * PRICES — list prices, transaction ladders, metered unit rates — and a
 * feature matrix is a different object that nothing owned. The visible cost:
 * `mediaCdn` was gated to paid tiers, the row was published on `/pricing` and
 * in Figma, and no document anywhere in Pricing & Packaging said so. There was
 * nothing to reconcile the live table against.
 *
 * Generated rather than written, because a hand-kept matrix of 8 plans x 34
 * features drifts on the first change nobody remembers to mirror — which is
 * the failure being fixed, not a new risk to accept. `PLAN_ENTITLEMENTS` is
 * the thing the product actually enforces, so it is the only honest source.
 *
 *   npx tsx tools/scripts/gen-feature-matrix.mts          # write both copies
 *   npx tsx tools/scripts/gen-feature-matrix.mts --check  # fail if stale
 *
 * The repo copy is what CI can read (Drive needs credentials CI does not
 * have); the Drive copy is the one sales and marketing open. Both are written
 * from the same string, so they cannot disagree with each other — only with
 * the code, which `--check` is there to catch.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { PLAN_ENTITLEMENTS } from '../../libs/aglyn/src/lib/app-utils/plan-entitlements'

const REPO_OUT = 'docs/feature-matrix.md'
const DRIVE_OUT =
  `${process.env['HOME']}/Library/CloudStorage/GoogleDrive-zach@aglyn.com/` +
  'Shared drives/Platform Docs/Pricing & Packaging/00-Pricing-Source-of-Truth/' +
  'Feature-Matrix.md'

const entitlements = PLAN_ENTITLEMENTS as unknown as Record<
  string,
  { features?: Record<string, unknown> }
>
const plans = Object.keys(entitlements)
const features = [
  ...new Set(plans.flatMap((p) => Object.keys(entitlements[p].features ?? {}))),
].sort()

const title = (plan: string) => plan.charAt(0).toUpperCase() + plan.slice(1)
const cell = (value: unknown) => (value === true ? '✓' : value === false ? '—' : String(value))

const rows = features.map((feature) => {
  const cells = plans.map((plan) => cell(entitlements[plan].features?.[feature]))
  return `| \`${feature}\` | ${cells.join(' | ')} |`
})

const body = `# Aglyn — Feature Matrix

**Generated. Do not hand-edit.** Run \`npx tsx tools/scripts/gen-feature-matrix.mts\`
after changing \`PLAN_ENTITLEMENTS\`, and commit both copies.

This table is a VIEW of \`libs/aglyn/src/lib/app-utils/plan-entitlements.ts\` —
the object the product actually enforces at runtime. It is not an independent
record and must never be edited to say something the code does not.

> **Why this exists.** The pricing docs tracked list prices, the transaction-fee
> ladder and the metered unit rates, but nothing owned the feature matrix. So
> when \`mediaCdn\` was gated to paid tiers, the row was published on
> \`aglyn.com/pricing\` and drawn in Figma with no document in Pricing &
> Packaging saying so — there was nothing to reconcile the live table against.
> A reader who wanted to know what Free includes had to read TypeScript.

**Change control.** A feature moving between plans is a packaging change and
takes a Pricing Decision Log entry, exactly as a price move does. Regenerating
this file is the last step, not the decision.

| Feature | ${plans.map(title).join(' | ')} |
|---|${plans.map(() => '---').join('|')}|
${rows.join('\n')}

_${features.length} features across ${plans.length} plans._
`

const check = process.argv.includes('--check')
if (check) {
  const current = existsSync(REPO_OUT) ? readFileSync(REPO_OUT, 'utf8') : ''
  if (current !== body) {
    console.error(
      `${REPO_OUT} is stale. PLAN_ENTITLEMENTS changed without regenerating it.\n` +
        'Run: npx tsx tools/scripts/gen-feature-matrix.mts',
    )
    process.exit(1)
  }
  console.log(`check:feature-matrix — OK (${features.length} features, ${plans.length} plans)`)
} else {
  writeFileSync(REPO_OUT, body)
  console.log('wrote', REPO_OUT)
  try {
    writeFileSync(DRIVE_OUT, body)
    console.log('wrote', DRIVE_OUT)
  } catch (error) {
    // Drive may simply not be mounted on this machine. Not fatal: the repo
    // copy is the one CI reads, and saying so beats failing the run.
    console.warn('Drive copy skipped —', (error as Error).message)
  }
}
