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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Every environment variable the product reads has a row in the published
 * reference.
 *
 * ## What removing this guard would let back in
 *
 * An operator configures a deployment from a document. A variable the code
 * reads and the document never names is a variable that stays unset, and the
 * failure mode of an unset variable here is almost never an error — it is a
 * feature that reports success and does nothing. The reference exists because
 * an audit of `process.env` reads found more than a hundred names the
 * self-host material had never mentioned, and among them were: a publish that
 * says "published" while the live page serves the old HTML for another ten
 * minutes (`REVALIDATE_SECRET`), a scheduled-job endpoint that refuses every
 * beat so nothing scheduled ever runs (`PLUGIN_JOBS_SECRET`), a campaign
 * pipeline that refuses to send (`EMAIL_UNSUBSCRIBE_SECRET`), and a
 * custom-domain wizard that hands an operator's customers a hosting vendor's
 * IP addresses (`AGLYN_TENANT_APEX_ADDRESSES`). None of those logged anything.
 *
 * Delete this spec and the next such variable is added silently, and is found
 * the way those were: by someone reading the source because the product was
 * lying to them.
 *
 * ## What it reads, and what it deliberately cannot see
 *
 * Enumerated from `git ls-files`, never a filesystem walk: a walk sweeps
 * `.next/` and `dist/`, which carry the vendored framework's own env reads and
 * would report a different repo depending on whether the reader had built.
 *
 * Comments are stripped first, so a docblock explaining how build-time
 * substitution works — which necessarily writes `process.env.NAME` — cannot
 * itself demand a row. The line-comment pass refuses to fire on `://` so a URL
 * literal survives it.
 *
 * Scope is `apps/`, `libs/` and `cloud/` — the code that runs in an operator's
 * containers and functions. `tools/` is repository tooling that never ships,
 * and holding it to the same bar would fill the reference with CI knobs.
 *
 * Two things the regex cannot see, handled explicitly:
 *  - {@link INDIRECT_READS} — names reached through a helper that takes the
 *    name as a parameter (`read('TX_WEBFILE_NUMBER')`) or through a constant
 *    (`env[SSO_DOMAIN_ENFORCEMENT_ENV]`). Listed by hand, with the file, so a
 *    reader can check them.
 *  - Assembled names — the per-plan Stripe add-on ids are built at call time as
 *    `STRIPE_PRICE_{PLAN}_{KIND}[_YEARLY]`, so there is no literal to match.
 *    The reference documents the pattern instead.
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')

/** The page an operator configures from. */
const REFERENCE = 'apps/docs/docs/developers/self-hosting-environment.md'

const IN_SCOPE = /^(apps|libs|cloud)\//
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const NOT_A_TEST = /\.spec\.|\.e2e\.|\.test\.|\/specs\/|\.stories\./

/**
 * Both spellings, because they are not interchangeable: Next substitutes the
 * dot form at build time and never the bracket form, and that difference is
 * the single most consequential fact in the reference.
 */
const ENV_READ =
  /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\])/g

/**
 * Names read through an indirection the regex above cannot follow, each with
 * the file that reads it.
 *
 * A name here is held to the same bar as a directly-read one — it is in the
 * reference or this spec fails. The list is hand-maintained because the
 * alternative is evaluating the code, and a guard that runs the code it is
 * guarding is not a guard.
 */
const INDIRECT_READS: Record<string, string> = {
  AGLYN_TAX_JURISDICTION: 'apps/console/utils/server/tax-filing-store.ts',
  AGLYN_TAX_REGISTRATION_ID: 'apps/console/utils/server/tax-filing-store.ts',
  AGLYN_TAX_FILING_ID: 'apps/console/utils/server/tax-filing-store.ts',
  TX_WEBFILE_NUMBER: 'apps/console/utils/server/tax-filing-store.ts',
  TX_TAXPAYER_NUMBER: 'apps/console/utils/server/tax-filing-store.ts',
  AGLYN_SSO_REQUIRED_DOMAINS:
    'libs/tenant/data/admin/src/lib/server/sso-domain-policy.ts',
  AGLYN_SSO_DOMAIN_ENFORCEMENT:
    'libs/tenant/data/admin/src/lib/server/sso-domain-policy.ts',
  NEXT_PUBLIC_ANALYTICS_ALLOW_NONPROD:
    'libs/aglyn/src/lib/app-utils/analytics-environment.ts',
  STRIPE_LIVEMODE: 'libs/aglyn/src/lib/app-utils/stripe-deployment-mode.ts',
  AGLYN_TRUSTED_PROXY_COUNT: 'libs/aglyn/src/lib/app-utils/request-ip.ts',
  AGLYN_REGION: 'libs/aglyn/src/lib/app-utils/deployment-shape.ts',
  FLY_REGION: 'libs/aglyn/src/lib/app-utils/deployment-shape.ts',
  AWS_REGION: 'libs/aglyn/src/lib/app-utils/deployment-shape.ts',
  AWS_DEFAULT_REGION: 'libs/aglyn/src/lib/app-utils/deployment-shape.ts',
  DOCS_URL: 'apps/docs/docusaurus.config.ts',
  DOCS_ORGANIZATION_NAME: 'apps/docs/docusaurus.config.ts',
  DOCS_GA_TRACKING_ID: 'apps/docs/docusaurus.config.ts',
  DOCS_ERROR_BEACON_ENDPOINT: 'apps/docs/docusaurus.config.ts',
  DOCS_STATUS_TARGETS: 'apps/docs/docusaurus.config.ts',
  DOCS_STATUS_FALLBACK_URL: 'apps/docs/docusaurus.config.ts',
}

/**
 * Names that are read but are not configuration anybody writes down, each with
 * the reason.
 *
 * Deliberately short. "It is obscure" is not a reason — the obscure ones are
 * exactly what the reference is for. A name belongs here only when the runtime
 * itself supplies it and an operator setting it would be a mistake.
 */
const NOT_A_SETTING: Record<string, string> = {
  NEXT_RUNTIME:
    'Set by Next itself to `nodejs` or `edge` so instrumentation can tell which bundle it is in. An operator setting it would lie to the framework about its own runtime.',
  TZ: 'The standard POSIX timezone variable, read by the jest configuration to pin test runs to UTC. Not a product setting.',
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
}

/** Word-bounded, so `VERCEL` is not satisfied by `VERCEL_TOKEN`. */
function documents(reference: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(reference)
}

describe('every environment variable the product reads is documented', () => {
  const reference = readFileSync(resolve(REPO_ROOT, REFERENCE), 'utf8')

  const files = execFileSync('git', ['ls-files'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((file) => IN_SCOPE.test(file))
    .filter((file) => SOURCE.test(file))
    .filter((file) => !NOT_A_TEST.test(file))

  /** name → the first file that reads it, for the failure message. */
  const readBy = new Map<string, string>()
  for (const file of files) {
    const source = stripComments(readFileSync(resolve(REPO_ROOT, file), 'utf8'))
    for (const match of source.matchAll(ENV_READ)) {
      const name = match[1] ?? match[2]
      if (name && !readBy.has(name)) readBy.set(name, file)
    }
  }
  for (const [name, file] of Object.entries(INDIRECT_READS)) {
    if (!readBy.has(name)) readBy.set(name, file)
  }

  const undocumentable = [...readBy.keys()]
    .filter((name) => !(name in NOT_A_SETTING))
    .sort()

  // Anti-vacuity, all three halves: a file list that stopped matching, a regex
  // that stopped matching, and a reference file that was emptied would each
  // otherwise make every assertion below pass while checking nothing.
  it('really reads the source, the regex really matches, and the reference is really there', () => {
    expect(files.length).toBeGreaterThan(500)
    expect(readBy.size).toBeGreaterThanOrEqual(100)
    expect(reference.length).toBeGreaterThan(10_000)
    // Three known reads, one per spelling the regex has to handle.
    expect(readBy.has('FIREBASE_PRIVATE_KEY')).toBe(true) // dot form
    expect(readBy.has('TOKEN_SIGNING_SECRET')).toBe(true) // bracket form
    expect(readBy.has('TX_WEBFILE_NUMBER')).toBe(true) // indirect
  })

  it('the exemption list has not become the answer to everything', () => {
    expect(Object.keys(NOT_A_SETTING).length).toBeLessThanOrEqual(12)
    for (const reason of Object.values(NOT_A_SETTING)) {
      expect(reason.length).toBeGreaterThan(40)
    }
  })

  it.each(undocumentable.map((name) => [name]))(
    '%s has a row in the reference',
    (name: string) => {
      if (!documents(reference, name)) {
        throw new Error(
          `${readBy.get(name)} reads ${name}, and ${REFERENCE} never names it.\n` +
            `An operator configures a deployment from that page. A variable it does not name is one that stays unset, ` +
            `and an unset variable here usually produces a feature that reports success and does nothing rather than an error.\n` +
            `Add a row — what it drives, where to get the value, its shape, its default, whether it is fixed at image-build time, ` +
            `and what an operator would observe with it unset — or add ${name} to NOT_A_SETTING with the reason the runtime, not the operator, supplies it.`,
        )
      }
    },
  )
})
