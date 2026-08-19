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

import { execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * "Community" belongs to the forum, not the marketplace (AGL-975).
 *
 * The marketplace was called `community` throughout the code long after the
 * product renamed it, and a public community forum is planned — so every
 * leftover is a name collision waiting to be resolved by whoever builds the
 * forum, under deadline, in someone else's code.
 *
 * This walked `apps/console` only, and that is precisely how the worst
 * leftover survived the sweep: `plugins.config.json` sits at the REPO ROOT and
 * still declared
 *
 *     { id: 'community', package: '@aglyn/plugins-community',
 *       register: { console: 'registerCommunityConsole', … },
 *       apiPrefixes: ['community'] }
 *
 * — a package, two functions and an API prefix that no longer exist. The
 * generated manifests it feeds had been renamed correctly, so nothing was
 * broken and nothing failed; but re-running
 * `tools/scripts/generate-plugin-manifests.mjs` regenerated them from the
 * stale config and silently reverted the marketplace to import a package that
 * is not there. Measured, not theorised: regenerating produced exactly that
 * diff before the fix, and reproduces the committed manifests byte-for-byte
 * after it.
 *
 * So the scope is now every tracked file, from `git ls-files` — build outputs
 * and untracked scratch are excluded for free, and nothing is missed because
 * a directory was not on a list.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')

/**
 * The WHOLE list, each a deliberate use. Adding to it asserts the same, and
 * the staleness test below makes a wrong entry fail rather than quietly widen
 * what is allowed.
 */
const ALLOWED = new Map<string, string>([
  // A byte-pinned verbatim capture of the LIVE publisher-agreement page,
  // hash-asserted by publisher-agreement-version.spec.ts — rewording it here
  // would break the pin on what publishers actually accepted. The word is the
  // PAGE's defect, not the snapshot's: the published agreement still says
  // "Aglyn community marketplace" (AGL-1840). When the page is republished
  // and re-captured under a new version, that snapshot must NOT need this
  // exemption; do not widen this entry to the whole legal directory.
  [
    'libs/aglyn/src/lib/app-utils/legal/publisher-agreement/2026-08-14.1/marketplace-publisher-agreement.txt',
    'Verbatim capture of the published page; the live page carries the stale name — AGL-1840.',
  ],
  // ---- The forum. This is the meaning the rename exists to protect. ----
  [
    'apps/console/app/api/support/forum/route.ts',
    'THE forum — AGL-142, categories/threads/replies for paid plans.',
  ],
  // The Support umbrella and its two channels (AGL-1158). The forum was half
  // of one page; splitting it moved the word across four new files, and this
  // map is the record that each one means the FORUM.
  [
    'apps/console/app/(app)/[orgSlug]/support/page.tsx',
    'The Support umbrella — names both channels while explaining which one ' +
      'it forwards a workspace to.',
  ],
  [
    'apps/console/app/(app)/[orgSlug]/support/forum/page.tsx',
    'THE forum’s own page — its heading, its docs anchor, its route.',
  ],
  [
    'apps/console/app/(app)/[orgSlug]/support/forum/layout.tsx',
    'The forum page’s browser title.',
  ],
  [
    'apps/console/app/(app)/[orgSlug]/support/tickets/page.tsx',
    'Points a forum-only tier at the forum, which is its whole support ' +
      'channel — the copy AGL-1103 requires this page to carry.',
  ],
  [
    'apps/console/components/support/support-channel-link.component.tsx',
    'The label on the link between the two Support channels.',
  ],
  [
    'apps/console/constants/docs-help.generated.ts',
    'Generated from the docs; the entry is the support/community forum page.',
  ],
  [
    'apps/console/constants/assist-docs-index.generated.ts',
    'The second generated docs artifact (AGL-1860) — Aglyn Assist’s ' +
      'retrieval index, which carries docs PROSE rather than just anchors, ' +
      'so it inherits the word from every forum page indexed above: ' +
      'support-and-community, enterprise/support-tiers, invite-teammates. ' +
      'Forum meaning throughout; verified no occurrence is marketplace-sense.',
  ],
  [
    'apps/docs/docs/workspace-and-billing/support-and-community.md',
    'The forum’s own documentation page.',
  ],
  [
    'apps/docs/docs/enterprise/support-tiers.md',
    'Documents the SUPPORT ladder, whose weakest tier is literally labelled ' +
      '“Community” in SUPPORT_BY_PLAN, and links to the forum page above. ' +
      'Support naming, not marketplace naming.',
  ],
  [
    'apps/docs/docs/staff-console/support-triage.md',
    'The support runbook (AGL-2141), which restates the SAME ladder as ' +
      'enterprise/support-tiers.md above — weakest tier literally labelled ' +
      '“Community” in SUPPORT_BY_PLAN — and points Free and Starter at the ' +
      'forum. Support naming, not marketplace naming. Exempted rather than ' +
      'reworded for the reason the ladder is quoted at all: a runbook that ' +
      'renamed the tier would disagree with the code an operator reads it ' +
      'against, which is the drift the table exists to prevent.',
  ],
  [
    'apps/docs/docs/workspace-and-billing/teams-and-roles/invite-teammates.md',
    'Points at the forum for help.',
  ],
  [
    'apps/docs/docs/workspace-and-billing/teams-and-roles/overview.md',
    'Points at the forum for help.',
  ],
  [
    'apps/docs/docs/staff-console/support-queue.md',
    'Staff view of the forum queue.',
  ],
  [
    'apps/docs/src/pages/trust.md',
    'Links to the support/community FORUM page for response targets.',
  ],
  [
    'libs/aglyn/src/lib/app-utils/support-tiers.ts',
    'The FREE tier’s support channel is the community forum, and “Community” ' +
      'is its name (AGL-1103) — the forum meaning again, not the marketplace.',
  ],
  [
    'libs/aglyn/src/lib/app-utils/support-tiers.spec.ts',
    'Asserts the Community tier commits to nothing.',
  ],

  // ---- Open-source project governance: "community" means contributors. ----
  ['CODE_OF_CONDUCT.md', 'Contributor covenant; the word is the boilerplate.'],
  ['CONTRIBUTING.md', 'Links Google’s Open Source Community Guidelines.'],
  [
    '.github/FUNDING.yml',
    'GitHub’s OWN schema key `community_bridge` — renaming it breaks the file.',
  ],
  [
    '.github/ISSUE_TEMPLATE/config.yml',
    'The literal https://github.community/ support URL.',
  ],

  // ---- Published bundles, frozen by their content hash. ----
  //
  // These are not "not worth changing" — they CANNOT change. Each is the exact
  // byte sequence recorded as `sha256` on a live version document, so editing
  // a comment inside one invalidates the pin that proves the artifact has not
  // been tampered with. Verified against production:
  //   office-hours/dist   1cd2d9c6… = marketplaceListings/ChiOYRKDeI @1.0.0
  //   promo-countdown/dist b691bc03… = marketplaceListings/Tfnrb4wJzF @1.0.0
  [
    'examples/plugins/office-hours/dist/plugin.bundle.mjs',
    'Hash-pinned published bundle (ChiOYRKDeI@1.0.0).',
  ],
  [
    'examples/plugins/promo-countdown/dist/plugin.bundle.mjs',
    'Hash-pinned published bundle (Tfnrb4wJzF@1.0.0).',
  ],
  [
    'examples/plugins/promo-countdown/src/index.js',
    'These examples have no build step — the source IS the bundle, byte for ' +
      'byte, so it inherits the pin above and must not drift from it.',
  ],

  // ---- Files that must name the word in order to forbid or drop it. ----
  //
  // Deliberately just two. Three other specs each carried their own copy of
  // the old name to assert something about it — the e2e that the retired API
  // prefix 404s, the route spec that no route path contains it, the rules spec
  // that the retired collection is denied. Every one of those is implied by
  // the sweep below: the word cannot appear in a tracked file at all, so it
  // cannot appear in a route, a prefix or a rules block. They were removed
  // rather than exempted, because an exemption is a place the word survives.
  ['apps/console/specs/no-community-naming.spec.ts', 'This guard.'],
  [
    'tools/scripts/drop-community-collections.mjs',
    'Named for what it drops. Goes when the drop runs — the migration script ' +
      'beside it already has, its copy being verified byte-identical.',
  ],

  // ---- Third-party package names we do not control. ----
  //
  // All THREE lockfiles, and the missing third is why this list exists in its
  // current form. Only the first two were exempted, so when the rename swept
  // every tracked file it did not skip cloud/functions/package-lock.json — it
  // "fixed" it, rewriting @eslint-community/regexpp and
  // @eslint-community/eslint-utils to an @eslint-marketplace scope that has
  // never existed on npm. Every npm ci in cloud/functions 404'd from that
  // commit until it was restored, and because the scope is unregistered, the
  // lockfile was one `npm publish` by a stranger away from resolving hostile
  // code. An exemption missing from this map does not weaken the sweep; it
  // points the sweep at a file that cannot survive it.
  ['package-lock.json', '@eslint-community/*, ansi-html-community.'],
  ['apps/docs/package-lock.json', 'Same third-party packages.'],
  ['cloud/functions/package-lock.json', '@eslint-community/* via eslint.'],

  // ---- Frozen legal text (AGL-1497). ----
  //
  // Verbatim snapshots of the Terms and Privacy Policy AS PUBLISHED, archived
  // so a clickwrap acceptance can prove what a user was shown. Both say
  // "community marketplace" because the published documents do.
  //
  // These are the one category of file the sweep must never touch: a hash of
  // each is recorded on every acceptance and asserted by
  // `legal-document-version.spec.ts`, so editing a word here does not tidy up
  // stale naming — it invalidates the evidence and fails that spec. The
  // wording is fixed by republishing the documents and archiving a NEW
  // version, never by rewriting an old one.
  [
    'apps/console/constants/legal/v1/terms.txt',
    'Frozen published Terms of Service (v1) — immutable evidence.',
  ],
  [
    'apps/console/constants/legal/v1/privacy.txt',
    'Frozen published Privacy Policy (v1) — immutable evidence.',
  ],
  [
    'apps/console/constants/legal/v2/terms.txt',
    'Frozen published Terms of Service (v2, AGL-1499) — immutable evidence.',
  ],
  [
    'apps/console/constants/legal/v2/privacy.txt',
    'Frozen published Privacy Policy (v2, AGL-1499) — immutable evidence.',
  ],
  [
    'apps/console/constants/legal/v3/terms.txt',
    'Frozen published Terms of Service (v3, AGL-1555) — immutable evidence.',
  ],
  [
    'apps/console/constants/legal/v3/privacy.txt',
    'Frozen published Privacy Policy (v3, AGL-1555) — immutable evidence.',
  ],
  [
    'apps/console/constants/legal/v4/terms.txt',
    'Frozen published Terms of Service (v4, AGL-1565) — immutable evidence.',
  ],
  [
    'apps/console/constants/legal/v4/privacy.txt',
    'Frozen published Privacy Policy (v4, AGL-1564) — immutable evidence.',
  ],
  // Zach's 2026-08-18 mandate, carried VERBATIM (3695fc02d). The word appears
  // as "the open source community" — the ordinary English meaning, in quoted
  // source material, not product naming. This block is under a standing
  // instruction never to paraphrase, summarise or edit it: it has already lost
  // a directive once by being summarised, which is why it is quoted rather
  // than described. Rewording it to satisfy this guard would defeat the commit
  // that carries it and silently alter words attributed to the founder.
  //
  // Scoped to the ONE file. Do not widen this to `.claude/` — the coverage
  // test below asserts that this remains the only exemption outside the
  // product tree, so widening it fails rather than quietly permitting more.
  // The generated release record. `8e72befb8` (1.0.0-beta.1) rendered the
  // AGL-2066 commit subject — "the no-community sweep exempts a verbatim
  // quote, narrowly" — into the changelog, and the guard went red on main
  // with nobody having filed it. The word is there as the NAME OF THIS GUARD
  // inside a shipped commit subject, which is the opposite of product naming.
  //
  // Exempted at the file rather than fixed in place, for two reasons: a
  // changelog is an append-only record of what was released and editing it
  // falsifies that, and it is REGENERATED from commit subjects — so any
  // future commit that mentions this guard by name reintroduces the line.
  // Losing product-naming coverage here costs nothing: a changelog is not a
  // product surface, and the surfaces this rename protects are still asserted
  // scanned by the narrowness test below.
  [
    'CHANGELOG.md',
    'Generated release record (AGL-2102): the word appears inside a quoted commit subject naming this very guard, and the file is regenerated from commit subjects so it cannot be fixed in place.',
  ],
  [
    '.claude/commands/release.md',
    "Verbatim capture of Zach's mandate; \"open source community\" is quoted speech, not product naming (AGL-2066).",
  ],
])

/** Anything whose bytes are not text we can meaningfully read. */
const BINARY = /\.(png|jpe?g|gif|ico|svg|webp|avif|woff2?|ttf|eot|pdf|zip|gz|mp4|webm|jar|keystore)$/i

function trackedFiles(): string[] {
  return execSync('git ls-files -z', { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((path) => !BINARY.test(path))
}

describe('the marketplace no longer calls itself community (AGL-975)', () => {
  const offenders: string[] = []

  beforeAll(() => {
    for (const rel of trackedFiles()) {
      if (ALLOWED.has(rel)) continue
      const abs = join(REPO_ROOT, rel)
      try {
        if (statSync(abs).size > 8 * 1024 * 1024) continue
        if (/community/i.test(readFileSync(abs, 'utf8'))) offenders.push(rel)
      } catch {
        // A tracked path that is not readable here (submodule, broken link)
        // is not evidence of a leftover.
      }
    }
  })

  it('has no stray "community" in any tracked file', () => {
    expect(offenders).toEqual([])
  })

  it('keeps every exemption honest', () => {
    // A stale exemption is worse than none: it silently permits the word in a
    // file that no longer has a reason to use it. Removing the /api/community
    // alias made one of these stale on its first real use, and this caught it.
    for (const [rel] of ALLOWED) {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf8')
      expect(`${rel}: ${/community/i.test(source)}`).toBe(`${rel}: true`)
    }
  })

  it('keeps the exemptions narrow, and still polices the product surfaces', () => {
    // An exemption is the ONE mechanism that can silently shrink this guard,
    // and AGL-2066 added the first entry outside the product tree — a verbatim
    // quote of Zach's mandate in `.claude/commands/release.md`. The staleness
    // test above only asks whether an exemption is still USED; it cannot see
    // an exemption that has grown to cover more than it should. This one asks
    // the other question: is the guard still pointed at what it exists for?

    // Exactly one exemption outside the product tree, named to the file.
    // Widening this to `.claude/` — the tempting shortcut — fails here.
    expect([...ALLOWED.keys()].filter((rel) => rel.startsWith('.claude/'))).toEqual([
      '.claude/commands/release.md',
    ])

    // Every exemption names a real FILE. A directory or prefix entry would
    // exempt everything beneath it, which `ALLOWED.has(rel)` would never
    // reveal because it matches on exact path.
    for (const rel of ALLOWED.keys()) {
      expect(`${rel}: ${rel.endsWith('/')}`).toBe(`${rel}: false`)
      expect(`${rel}: ${statSync(join(REPO_ROOT, rel)).isFile()}`).toBe(`${rel}: true`)
    }

    // The surfaces the rename exists to protect are still scanned. If an
    // exemption ever swallowed one of these, the sweep above would pass by
    // covering nothing — the failure mode that makes a green meaningless.
    const scanned = trackedFiles().filter((rel) => !ALLOWED.has(rel))
    for (const surface of [
      'apps/console/app/',
      'libs/plugins/marketplace/src/',
      'apps/tenant/app/',
      'libs/aglyn/src/lib/app-utils/',
    ]) {
      const covered = scanned.filter((rel) => rel.startsWith(surface)).length
      expect(`${surface} scanned: ${covered > 0}`).toBe(`${surface} scanned: true`)
    }
  })

  it('has no route path carrying the word', () => {
    // The collision that matters most: a marketplace URL squatting on
    // /community would take the path the forum wants.
    const routes = readFileSync(
      join(REPO_ROOT, 'libs/aglyn/src/lib/app-utils/console-routes.ts'),
      'utf8',
    )
    expect(routes).not.toMatch(/community/i)
  })

  it('registers the marketplace plugin under its real package and exports', () => {
    // The regression this file failed to catch. Assert the plugin registry
    // against what the library ACTUALLY exports, so a stale entry fails here
    // rather than at the next `generate-plugin-manifests` run.
    const config = JSON.parse(
      readFileSync(join(REPO_ROOT, 'plugins.config.json'), 'utf8'),
    ) as { plugins: Array<{ id: string; package: string; register?: Record<string, string> }> }

    const entry = config.plugins.find((plugin) => plugin.id === 'marketplace')
    expect(entry?.package).toBe('@aglyn/plugins-marketplace')

    for (const exported of Object.values(entry?.register ?? {})) {
      const source = readFileSync(
        join(REPO_ROOT, 'libs/plugins/marketplace/src/lib', exported.endsWith('Api') ? 'server.ts' : 'plugin.ts'),
        'utf8',
      )
      expect(`${exported}: ${source.includes(`export function ${exported}(`)}`).toBe(
        `${exported}: true`,
      )
    }
  })
})
