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

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../../../..')

/**
 * Every variable the tenant middleware needs from an operator must be IN the
 * template that operator fills in (AGL-2424).
 *
 * `AGLYN_TENANT_HOST_CNAME` — the single value host resolution matches an
 * incoming `Host:` against — was documented in the runbook prose and absent
 * from `.env.selfhost.example`, so an operator who did what
 * `docker-compose.yml`'s own header says (`cp` the template, fill it in,
 * `docker compose up --build`) left it unset and every visitor to every
 * published site was redirected to the console: the AGL-2177 outcome, reached
 * through the env template instead of through the code.
 *
 * The left-hand side is read out of the middleware rather than listed here, so
 * a variable the middleware STARTS reading fails this until it is either in the
 * template or explicitly exempted below.
 */
const TENANT_MIDDLEWARE = 'apps/tenant/middleware.ts'
const SELFHOST_TEMPLATE = '.env.selfhost.example'

/** Names that are deliberately not operator configuration, each with a why. */
const NOT_OPERATOR_CONFIG: Record<string, string> = {
  AGLYN_STANDALONE:
    'Set as image ENV in the runner stage on purpose (AGL-2221) — in the template an operator could delete it and silently re-break serving.',
  AGLYN_TENANT_DEMO: "Aglyn's own demo deployment; meaningless elsewhere.",
  NODE_ENV: 'Set by the runner stage; not something an operator chooses.',
  VERCEL: "Vercel's own variable, present only on Aglyn-operated deployments.",
  VERCEL_ENV: "Vercel's own variable, present only on Aglyn-operated deployments.",
}

describe('self-host env template covers the tenant runtime (AGL-2424)', () => {
  const middleware = readFileSync(join(REPO_ROOT, TENANT_MIDDLEWARE), 'utf8')
  const template = readFileSync(join(REPO_ROOT, SELFHOST_TEMPLATE), 'utf8')

  const readNames = [
    ...new Set(
      [...middleware.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort()

  const operatorNames = readNames.filter(
    (name) => !(name in NOT_OPERATOR_CONFIG),
  )

  // Anti-vacuity, both halves: a middleware that stopped reading env, or a
  // regex that stopped matching, would otherwise make this describe block
  // assert nothing at all.
  it('the middleware really is read, and really does read env', () => {
    expect(middleware.length).toBeGreaterThan(1000)
    expect(readNames.length).toBeGreaterThanOrEqual(5)
    expect(readNames).toContain('AGLYN_TENANT_HOST_CNAME')
    expect(operatorNames.length).toBeGreaterThanOrEqual(1)
  })

  it.each(operatorNames.map((name) => [name]))(
    '%s is a line in .env.selfhost.example',
    (name: string) => {
      const declared = new RegExp(`^${name}=`, 'm').test(template)
      if (!declared) {
        throw new Error(
          `apps/tenant/middleware.ts reads ${name}, and .env.selfhost.example has no \`${name}=\` line. ` +
            `An operator fills in the template — a variable that is only mentioned in the runbook prose is a variable that stays unset, ` +
            `and an unset one here means published sites redirect their visitors to the console instead of being served. ` +
            `Add the line, or add ${name} to NOT_OPERATOR_CONFIG with the reason it is not the operator's to set.`,
        )
      }
    },
  )

  it('every exemption states a reason', () => {
    for (const reason of Object.values(NOT_OPERATOR_CONFIG)) {
      expect(reason.trim().length).toBeGreaterThan(20)
    }
  })

  it('no exemption is stale — the middleware still reads each one', () => {
    const stale = Object.keys(NOT_OPERATOR_CONFIG)
      .filter((name) => !readNames.includes(name))
      .sort()
    expect(stale).toEqual([])
  })
})
