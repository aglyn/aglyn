/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  derivePublishedRows,
  EGRESS_HOSTS,
  SDK_EGRESS,
  SUPERVISORY_AUTHORITY_HOSTS,
} from './subprocessor-inventory'

/**
 * A third-party host cannot start receiving data undeclared (AGL-1648).
 *
 * Linear received customer personal data from the console for weeks while four
 * green checks ran over the code — a package-closure scan (this is a
 * first-party `fetch`), a cookie-writer scan (no cookie), a guard pinned to
 * one env var name, and a prose-to-prose legal diff. The header of
 * `subprocessor-inventory.ts` has the full table.
 *
 * So the unit here is the OUTBOUND HOST, and the sweep is over the repo's own
 * source rather than over anything a vendor supplies. That is the one key
 * `api.linear.app` could not have hidden behind.
 *
 * ## Why the host filters live in THIS file and not the registry
 *
 * `selfhost-hardcoded-hosts.spec.ts` refuses Aglyn's own hostnames in runtime
 * code, and it skips `*.spec.*`. The first-party pattern below is exactly the
 * thing that guard exists to stop, so it belongs on this side of the line —
 * and the registry itself stays free of our own hostnames, which is also what
 * a self-hoster reading it deserves.
 *
 * ## Both directions, as always
 *
 * An undeclared host fails. A declaration whose host no longer appears fails
 * too — a stale row on a published legal page naming a vendor we dropped is
 * the other half of the same defect, and it is the half a register that only
 * ever grows always gets wrong.
 */

const REPO_ROOT = join(__dirname, '../../..')

/** Source we actually ship or run. */
const SOURCE = /\.(ts|tsx|mjs|cjs|js|jsx)$/

/**
 * Test code, fixtures and build artefacts are out.
 *
 * Specs are excluded for the same reason `cookie-inventory.spec.ts` excludes
 * them: a fixture naming `evil.example` is a fixture. The cost is real and
 * worth naming — a `fetch` that only ever happens in a spec is invisible here,
 * which is correct, and a production module that somehow only appears under a
 * `specs/` path would be too, which is not. Nothing in the tree is shaped that
 * way today.
 */
const NOT_SOURCE = /\.spec\.|\.test\.|\/specs\/|\/e2e\/|-e2e\/|\.generated\.|\.stories\./

/** A syntactically real hostname: labels, dots, no trailing separator. */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/**
 * Reserved and loopback names, per RFC 2606 and RFC 6761. `example.com`,
 * anything under `.example`, `.test`, `.invalid` and `.local`, and the
 * loopback literals. These can never resolve to a real recipient, which is
 * precisely why the repo's fixtures use them.
 */
const RESERVED =
  /(^|\.)(localhost|example\.(com|net|org)|example|test|invalid|local)$|^127\.0\.0\.1$|^0\.0\.0\.0$/

/** Aglyn's own deployment hosts. Not third parties; nothing leaves. */
const FIRST_PARTY = /(^|\.)aglyn\.(com|app|io)$/

/**
 * Comment lines are skipped.
 *
 * Without this the Apache licence header puts `www.apache.org` in every one of
 * ~15,000 files and the signal is gone. The trade is stated in the registry
 * header: a URL that appears ONLY in a docblock is invisible to this sweep. A
 * `fetch` needs its URL in code to work, so the miss is a documented one
 * rather than a hole in the mechanism.
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.startsWith('*') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*')
  )
}

function trackedSourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '--', 'apps', 'libs', 'tools'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\n')
    .filter((file) => file && SOURCE.test(file) && !NOT_SOURCE.test(file))
    .sort()
}

/** Third-party host, mapped to the files naming it. */
function sweepThirdPartyHosts(files: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of files) {
    let source: string
    try {
      source = readFileSync(join(REPO_ROOT, file), 'utf8')
    } catch {
      continue
    }
    if (!source.includes('://')) continue
    for (const line of source.split('\n')) {
      if (isCommentLine(line)) continue
      for (const match of line.matchAll(/https?:\/\/([A-Za-z0-9._-]+)/g)) {
        const host = match[1].toLowerCase()
        if (!HOSTNAME.test(host)) continue
        if (RESERVED.test(host) || FIRST_PARTY.test(host)) continue
        const files_ = found.get(host)
        if (files_) {
          if (!files_.includes(file)) files_.push(file)
        } else {
          found.set(host, [file])
        }
      }
    }
  }
  return found
}

const files = trackedSourceFiles()
const found = sweepThirdPartyHosts(files)
const foundHosts = [...found.keys()].sort()
const declared = Object.keys(EGRESS_HOSTS).sort()

describe('the subprocessor egress sweep reads the repo (AGL-1648)', () => {
  /**
   * Anti-vacuity, first and loudest.
   *
   * "No undeclared host" is also the answer when the glob matched nothing, the
   * pattern compiled wrong, or `git ls-files` was run from the wrong cwd. Every
   * one of those produces a green suite and zero coverage, which is worse than
   * having no guard because it reads as evidence.
   */
  it('enumerates a real population of source files', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('apps/console/app/api/_lib/linear-issues.ts')
    expect(files).toContain('libs/shared/util/email/src/lib/send-email.ts')
    expect(files).toContain(
      'libs/tenant/data/admin/src/lib/server/ga4-measurement-protocol.ts',
    )
  })

  it('still finds the hosts it was written about', () => {
    // `api.linear.app` is the regression test for this whole file. If the
    // sweep ever stops naming it, the sweep is broken — not the tree.
    expect(foundHosts).toContain('api.linear.app')
    expect(found.get('api.linear.app')).toContain(
      'apps/console/app/api/_lib/linear-issues.ts',
    )
    expect(foundHosts).toContain('api.stripe.com')
    expect(foundHosts).toContain('www.google-analytics.com')
    expect(foundHosts.length).toBeGreaterThan(20)
  })

  it('excludes first-party and reserved names rather than declaring them', () => {
    // The filters are the only reason the residual is readable, so they get
    // their own assertion instead of being trusted implicitly.
    for (const host of foundHosts) {
      expect([host, FIRST_PARTY.test(host)]).toEqual([host, false])
      expect([host, RESERVED.test(host)]).toEqual([host, false])
    }
  })
})

describe('every third-party host is declared (AGL-1648)', () => {
  it('has no undeclared outbound host', () => {
    const undeclared = foundHosts.filter((host) => !(host in EGRESS_HOSTS))
    if (undeclared.length) {
      throw new Error(
        'These third-party hosts are named by this repo\'s own code and are not declared in apps/console/constants/subprocessor-inventory.ts.\n' +
          'This is the shape of the Linear defect: a first-party fetch to a vendor that appears on no published list, with every other check structurally blind to it.\n' +
          'Declare each one with a disposition, a reason and what it receives. If it is a subprocessor, publish the /legal/subprocessors row FIRST and record the change-log date — /legal/dpa 7.1 makes that page Annex III to the SCCs:\n  ' +
          undeclared
            .map((host) => `${host}  <- ${found.get(host)?.join(', ')}`)
            .join('\n  '),
      )
    }
  })

  it('has no declaration for a host the code no longer names', () => {
    const gone = declared.filter((host) => !found.has(host))
    if (gone.length) {
      throw new Error(
        'These declarations no longer match anything in the tree. Remove the entry AND, for a subprocessor, take its row off the published page with a change-log line — a legal document naming a vendor we dropped is the stale half of the same defect:\n  ' +
          gone.join('\n  '),
      )
    }
  })

  it('keeps the supervisory-authority shortcut honest', () => {
    // Thirty hosts share one declaration. That is a shortcut, and a shortcut
    // that outlives its file quietly widens what is allowed — so the file is
    // asserted to still be the thing producing them.
    const source = readFileSync(
      join(REPO_ROOT, 'apps/console/utils/server/member-state-exposure.ts'),
      'utf8',
    )
    for (const host of SUPERVISORY_AUTHORITY_HOSTS) {
      expect([host, source.includes(host)]).toEqual([host, true])
    }
  })
})

describe('every declaration says why, and what it receives (AGL-1648)', () => {
  it('carries prose a reader could act on', () => {
    for (const [host, entry] of Object.entries(EGRESS_HOSTS)) {
      expect([host, entry.reason.length > 40]).toEqual([host, true])
      expect([host, entry.dataReceived.length > 20]).toEqual([host, true])
    }
  })

  it('gives every subprocessor an entity, a region, a purpose and a publication date', () => {
    const incomplete: string[] = []
    for (const [host, entry] of Object.entries(EGRESS_HOSTS)) {
      if (entry.disposition !== 'subprocessor') continue
      if (
        !entry.entity ||
        !entry.region ||
        !entry.purpose ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.publishedOn))
      ) {
        incomplete.push(host)
      }
    }
    if (incomplete.length) {
      throw new Error(
        'A subprocessor declaration is incomplete. `publishedOn` is the mechanism, not decoration: it is the date the /legal/subprocessors change log records, and it cannot be written honestly without opening the page:\n  ' +
          incomplete.join('\n  '),
      )
    }
  })

  it('makes a non-subprocessor say which of the two admissible reasons applies', () => {
    // "It seemed minor" is not one of them. Either nothing personal reaches
    // the host, or the customer chose the destination.
    for (const [host, entry] of Object.entries(EGRESS_HOSTS)) {
      if (entry.disposition === 'subprocessor') continue
      expect([host, entry.publishedOn]).toEqual([host, undefined])
    }
    const notSubprocessors = Object.entries(EGRESS_HOSTS).filter(
      ([, entry]) => entry.disposition === 'not-a-subprocessor',
    )
    for (const [host, entry] of notSubprocessors) {
      expect([
        host,
        /customer-chosen|customer site is seeded|no customer|nothing|aglyn-owned/i.test(
          `${entry.reason} ${entry.dataReceived}`,
        ),
      ]).toEqual([host, true])
    }
  })

  it('still loads every SDK recipient the sweep cannot see', () => {
    // The `THIRD_PARTY_COOKIES` trick: where no scan of our source can find
    // the host, pin a symbol proving we still reach it — so at minimum a
    // dropped integration loses its published row.
    const missing: string[] = []
    for (const [name, entry] of Object.entries(SDK_EGRESS)) {
      const hits = execFileSync(
        'git',
        ['grep', '-l', '--fixed-strings', entry.token, '--', 'apps', 'libs'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      ).trim()
      if (!hits) {
        missing.push(
          `${name}: nothing names ${entry.token} any more, so ${entry.entity} may owe one row fewer on /legal/subprocessors`,
        )
      }
      expect([name, /^\d{4}-\d{2}-\d{2}$/.test(entry.publishedOn)]).toEqual([
        name,
        true,
      ])
    }
    if (missing.length) throw new Error(missing.join('\n  '))
  })
})

describe('the registry is the source for the published list (AGL-1648)', () => {
  const rows = derivePublishedRows()

  it('derives one row per recipient entity, each with a publication date', () => {
    expect(rows.length).toBeGreaterThan(3)
    for (const row of rows) {
      expect([row.entity, /^\d{4}-\d{2}-\d{2}$/.test(row.publishedOn)]).toEqual([
        row.entity,
        true,
      ])
      expect([row.entity, row.reaches.length > 0]).toEqual([row.entity, true])
    }
  })

  it('names every entity the DPA and the page have to carry', () => {
    const entities = rows.map((row) => row.entity)
    expect(entities).toContain('Linear Orbit, Inc.')
    expect(entities).toContain('Stripe, Inc.')
    expect(entities).toContain('Vercel Inc.')
    expect(entities).toContain('Resend (Plus Five Five, Inc.)')
    expect(entities).toContain('Anthropic PBC')
    expect(entities).toContain('Google LLC (Firebase / Google Cloud)')
  })

  it('folds every host and SDK into exactly one entity row', () => {
    const reached = rows.flatMap((row) => row.reaches)
    expect(new Set(reached).size).toBe(reached.length)
    const expected = [
      ...Object.entries(EGRESS_HOSTS)
        .filter(([, entry]) => entry.disposition === 'subprocessor')
        .map(([host]) => host),
      ...Object.keys(SDK_EGRESS),
    ].sort()
    expect(reached.sort()).toEqual(expected)
  })

  it('keeps Linear in the derived list with the data the route really sends', () => {
    // The regression test, stated as the published row rather than as a host.
    const linear = rows.find((row) => row.entity === 'Linear Orbit, Inc.')
    expect(linear?.reaches).toEqual(['api.linear.app'])
    const entry = EGRESS_HOSTS['api.linear.app']
    for (const claim of ['email address', 'viewport', 'user-agent', 'plan']) {
      expect([claim, entry.dataReceived.includes(claim)]).toEqual([claim, true])
    }
    // And the claim is checked against the route, not just asserted here.
    const route = readFileSync(
      join(REPO_ROOT, 'apps/console/app/api/issue-reports/route.ts'),
      'utf8',
    )
    for (const field of ['reporterEmail', 'orgPlan', 'correlationId']) {
      expect([field, route.includes(field)]).toEqual([field, true])
    }
  })
})

describe('no notice-period arithmetic was reintroduced (AGL-1648)', () => {
  /**
   * The 30-day advance-notice obligation was DELETED from DPA 7.2 on
   * 2026-08-24 by Zach's explicit decision, the softer option having been
   * offered and rejected. An earlier design for this registry computed
   * `mayBeginProcessingOn = publishedOn + 30 days`; building it would have the
   * code assert a commitment the legal text no longer makes.
   *
   * The reasoning — zero customers, so nobody is owed notice — expires at the
   * first signature. This test pins the expiry note to the file so a later
   * reader finds the trigger rather than a bare absence.
   */
  const registry = readFileSync(
    join(REPO_ROOT, 'apps/console/constants/subprocessor-inventory.ts'),
    'utf8',
  )

  /**
   * Comments stripped, so the paragraph EXPLAINING why the arithmetic must not
   * exist does not read as the arithmetic existing. Same reason
   * `selfhost-hardcoded-hosts.spec.ts` strips them, and the same trap: the
   * first draft of this assertion went red on its own rationale.
   */
  const code = registry
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')

  it('records that the no-notice reasoning expires at the first customer', () => {
    expect(registry).toContain('expires the moment the first customer signs')
  })

  it('computes nothing from a publication date', () => {
    // A crude but honest check: no date arithmetic, no day constants, no
    // notice-window field. If a future change needs any of these, the DPA has
    // to say so first.
    expect(code).not.toMatch(/mayBeginProcessingOn|noticePeriod|noticeDays/)
    expect(code).not.toMatch(/\bDate\.(now|parse|UTC)\b/)
    expect(code).not.toMatch(/86_?400_?000|30\s*\*\s*24/)
  })
})
