/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * NO SITE'S MAIL LEAVES ON `aglyn.com`.
 *
 * `USAGE_EMAIL_FROM` is an address on the domain Aglyn's own billing, account
 * and console mail leaves from. Every `sendEmail` that does not resolve an
 * identity falls back to it — which was, until this sweep, what nearly every
 * tenant-owned sender did. The consequence is that a merchant who imports a
 * purchased list and mails it generates complaints against the same domain
 * every other customer's password reset depends on.
 *
 * The fix has three parts, and this file is the third:
 *
 *  1. `resolveHostSendingIdentity` cannot return a platform address at all.
 *  2. `sendEmail` refuses a `tenant` message with no resolved identity rather
 *     than falling back.
 *  3. This sweep asserts every tenant-owned send site actually says `tenant`.
 *
 * ## Why a sweep and not a unit test
 *
 * No test of any one sender can find this, because each one passes on its own
 * terms — it sends mail, and the mail arrives. Only an exhaustive read of the
 * tree can say that NONE of them is missing the declaration, which is the same
 * argument `sending-domain-credential-isolation.spec.ts` and
 * `email-send-metering-coverage.spec.ts` make about their own invariants.
 *
 * A new sender added to a plugin without the declaration fails here, naming
 * the file and the line — rather than silently mailing a site's customers
 * from the platform's domain and being noticed, if at all, in a deliverability
 * report months later.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')

/**
 * The trees where a send is a SITE talking to its own visitors.
 *
 * Plugins are tenant surfaces by definition — a plugin's mail is a merchant's
 * mail. The tenant runtime is the published site itself. `apps/console` is
 * deliberately absent: the console is Aglyn talking to its customers, and its
 * mail belongs on `aglyn.com`.
 */
const TENANT_ROOTS = [
  join('libs', 'plugins'),
  join('libs', 'tenant', 'runtime'),
]

/**
 * Tenant-tree files whose sends are genuinely PLATFORM mail, each with the
 * reason it is not a site speaking.
 *
 * An allowlist with a justification per entry, rather than a pattern: "which
 * of a tenant plugin's senders is actually the platform" is a judgement about
 * who the recipient is, and a rule that could infer it would be a rule that
 * could infer it wrongly.
 */
const PLATFORM_SENDERS: Record<string, string> = {
  [join('apps', 'tenant', 'app', 'api', '_legal-intake', 'acknowledge.ts')]:
    'DMCA and abuse acknowledgements. The recipient is the REPORTER in ' +
    "Aglyn's own legal process, not the site's customer, and the mail is " +
    'metered as platform rather than to the host.',
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', '.nx', 'tmp'])

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(full))
      continue
    }
    if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
      found.push(full)
    }
  }
  return found
}

const TENANT_FILES = TENANT_ROOTS.flatMap((root) =>
  sourceFiles(join(REPO_ROOT, root)),
).map((path) => ({
  path: relative(REPO_ROOT, path),
  text: readFileSync(path, 'utf8'),
}))

/**
 * The options object of one `sendEmail({ … })` call, as source text.
 *
 * Brace-matched rather than regex-captured. A `sendEmail` call contains nested
 * objects (`headers`, `tags`) and template literals with braces in them, and a
 * non-greedy match to the first `}` would cut the options short — reading a
 * correctly-declared call as undeclared, which is a failing test nobody can
 * act on.
 */
function sendEmailCalls(text: string): { line: number; body: string }[] {
  const calls: { line: number; body: string }[] = []
  const marker = /\bsendEmail\s*\(\s*\{/g
  let match: RegExpExecArray | null

  while ((match = marker.exec(text))) {
    const start = match.index + match[0].length - 1
    let depth = 0
    let end = start
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]
      if (character === '{') depth += 1
      else if (character === '}') {
        depth -= 1
        if (depth === 0) {
          end = index
          break
        }
      }
    }
    calls.push({
      line: text.slice(0, match.index).split('\n').length,
      body: text.slice(start, end + 1),
    })
  }

  return calls
}

describe('the sweep can actually see the tree', () => {
  /*
   * The premise guard. A search that silently matched nothing would let every
   * assertion below pass while proving nothing — the failure a bad root or a
   * blocked directory produces, and the reason a known-present control is
   * checked first.
   */
  it('reads the plugin and tenant-runtime trees', () => {
    expect(TENANT_FILES.length).toBeGreaterThan(100)
    expect(
      TENANT_FILES.some((file) =>
        file.path.endsWith(join('plugins', 'commerce', 'src', 'lib', 'server', 'gift-cards.ts')),
      ),
    ).toBe(true)
  })

  it('finds send sites at all, so a zero result would be visible', () => {
    const senders = TENANT_FILES.filter((file) => sendEmailCalls(file.text).length)
    expect(senders.length).toBeGreaterThan(5)
  })

  /** The parser must survive the calls it actually meets. */
  it('reads a whole options object, nested braces and all', () => {
    const parsed = sendEmailCalls(
      'await sendEmail({ to, headers: { a: `${x}` }, audience: "tenant" })',
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0].body).toContain('audience')
  })
})

describe("every tenant-owned sender says whose mail it is", () => {
  /**
   * The assertion this file exists for.
   *
   * A tenant send must declare `audience: 'tenant'`. That is what makes
   * `USAGE_EMAIL_FROM` unreachable for it — without the declaration the send
   * silently keeps the old behavior, which is the platform domain.
   */
  it('declares a tenant audience at every send site', () => {
    const undeclared: string[] = []

    for (const file of TENANT_FILES) {
      if (PLATFORM_SENDERS[file.path]) continue
      for (const call of sendEmailCalls(file.text)) {
        if (/audience\s*:\s*'tenant'/.test(call.body)) continue
        undeclared.push(`${file.path}:${call.line}`)
      }
    }

    expect(undeclared).toEqual([])
  })

  /**
   * A declaration with no identity behind it refuses at runtime rather than
   * falling back — correct, but it means a site cannot send at all. So the
   * declaration has to come with a resolution, and the resolution has to be
   * derived from the HOST rather than from anything in the request.
   */
  it('resolves a sending identity at every site that declares one', () => {
    const unresolved: string[] = []

    for (const file of TENANT_FILES) {
      if (PLATFORM_SENDERS[file.path]) continue
      for (const call of sendEmailCalls(file.text)) {
        if (!/audience\s*:\s*'tenant'/.test(call.body)) continue
        // `sendingIdentity: x` OR the shorthand `sendingIdentity,`. Matching
        // only the colon form would read a correctly-wired call as unwired,
        // which is a failing test nobody can act on.
        if (/\bsendingIdentity\b\s*[,:}]/.test(call.body)) continue
        unresolved.push(`${file.path}:${call.line}`)
      }
    }

    expect(unresolved).toEqual([])
  })
})

describe('the platform senders are named, not inferred', () => {
  /**
   * An allowlist that has gone stale is an allowlist that excuses a file which
   * no longer exists — and, worse, would excuse a NEW file that happened to be
   * created at the same path. Every entry has to still be a real sender.
   */
  it('names only files that exist and actually send', () => {
    for (const [path, reason] of Object.entries(PLATFORM_SENDERS)) {
      const text = readFileSync(join(REPO_ROOT, path), 'utf8')
      expect(sendEmailCalls(text).length).toBeGreaterThan(0)
      expect(reason.length).toBeGreaterThan(40)
    }
  })

  /**
   * And the exemption must be narrow. A platform sender inside a tenant tree
   * is an exception; if the list ever grew to cover most of the tree it would
   * have stopped being one, and this sweep would be asserting nothing.
   */
  it('keeps the exemption list short', () => {
    expect(Object.keys(PLATFORM_SENDERS).length).toBeLessThan(4)
  })
})

describe('the console keeps the platform identity', () => {
  /**
   * The other half of the rule, and the reason `audience` exists rather than
   * `USAGE_EMAIL_FROM` being deleted. Aglyn's own mail to its own customers
   * still leaves on `aglyn.com`, and a console sender that started declaring
   * itself a tenant would refuse every billing email on a deployment where no
   * site is involved at all.
   */
  it('declares no tenant audience anywhere in the console app', () => {
    const consoleFiles = sourceFiles(join(REPO_ROOT, 'apps', 'console')).map(
      (path) => ({ path: relative(REPO_ROOT, path), text: readFileSync(path, 'utf8') }),
    )
    expect(consoleFiles.length).toBeGreaterThan(100)

    const declared = consoleFiles
      .filter((file) =>
        sendEmailCalls(file.text).some((call) =>
          /audience\s*:\s*'tenant'/.test(call.body),
        ),
      )
      .map((file) => file.path)

    expect(declared).toEqual([])
  })

  it('is not itself inside a tenant root', () => {
    const consolePrefix = join('apps', 'console') + sep
    expect(TENANT_FILES.some((file) => file.path.startsWith(consolePrefix))).toBe(
      false,
    )
  })
})
