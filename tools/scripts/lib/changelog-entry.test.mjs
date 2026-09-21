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
 * Pins the customer-facing changelog's wording (AGL-3211).
 *
 *   node --test tools/scripts/lib/changelog-entry.test.mjs
 *
 * THE DANGEROUS FAILURE HERE IS A PLAUSIBLE ENTRY, not a thrown error. Every
 * case below is a rule that AGL-2848's backfill got wrong first and only
 * discovered by regenerating the sixteen entries a human had already written
 * in the console: an entry that silently drops a release's work, or claims a
 * release that never served, reads perfectly well and is wrong forever.
 *
 * The fixture is v1.0.0-beta.117 as published — a real release, its real
 * commits, and the exact excerpt and body that are live on aglyn.com.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  americanize,
  areaFor,
  cleanSummary,
  isVersionBump,
  renderExcerpt,
  renderReleaseEntry,
  sectionsFor,
} from './changelog-entry.mjs'
import { parseCommit } from './release-version.mjs'

const commit = (sha, subject) => parseCommit({ sha, subject, body: '' })

/** v1.0.0-beta.117, in the order production's merge introduced them. */
const BETA_117 = [
  commit('a1', 'chore(release): v1.0.0-beta.117 (AGL-2089)'),
  commit('a2', 'feat(seo): publish a VideoObject for the films a page actually ships (AGL-2962)'),
  commit('a3', 'feat(video): open the film in a lightbox without shipping a dialog to everyone (AGL-2961)'),
  commit('a4', 'feat(video): let the poster carry the page and download nothing else (AGL-2960)'),
  commit('a5', 'feat(agents): publish an RFC 9727 API catalog on every tenant site (AGL-2957)'),
  commit('a6', 'fix(cli): send the cursor under the name the server itself used (AGL-2959)'),
  commit('a7', 'fix(agents): type the catalog spec’s helper instead of its default value (AGL-2958)'),
  commit('a8', 'fix(agents): read the configured brand in the API catalog’s platform entry (AGL-2957)'),
  commit('a9', 'fix(video): read what the DAM now knows instead of the shape it was guessed to have (AGL-2963)'),
  commit('a10', 'fix(video): the lightbox dialog had no accessible name (AGL-2961)'),
  commit('a11', 'refactor(api): paginate /api/screen on cursor, keeping the old spelling (AGL-2955)'),
  commit('a12', 'docs(besigner): give video its own page, so the catalog stops out-ranking drag-drop (AGL-2964)'),
  commit('a13', 'docs(tests): say what an omitted barrel export costs, without pointing at a note (AGL-2954)'),
  commit('a14', 'chore(guard): lint the staged tools scripts, and write down the tiers (AGL-2837)'),
]

describe('the entry a released version publishes', () => {
  const entry = renderReleaseEntry({
    version: '1.0.0-beta.117',
    commits: BETA_117,
    servedAt: '2026-09-10T17:37:55Z',
    ref: 'v1.0.0-beta.117',
    previousRef: 'v1.0.0-beta.116',
  })

  it('is addressed and dated as the site published it', () => {
    assert.equal(entry.title, 'v1.0.0-beta.117')
    assert.equal(entry.slug, 'v1-0-0-beta-117')
    // To the minute. The seconds of a deployment status are noise, and the
    // console's own publish-date dialog cannot express them either.
    assert.equal(entry.publishedAt, '2026-09-10T17:37:00Z')
  })

  it('reproduces the excerpt that is live', () => {
    assert.equal(
      entry.excerpt,
      'Publish a VideoObject for the films a page actually ships. 13 changes ' +
        'in all: 4 new, 5 fixes, 1 changed, 2 docs and 1 behind the scenes.',
    )
  })

  it('reproduces the body that is live', () => {
    assert.equal(
      entry.body,
      [
        'Released to production on September 10, 2026 at 17:37 UTC. [See every commit in this release on GitHub](https://github.com/aglyn/aglyn/compare/v1.0.0-beta.116...v1.0.0-beta.117)',
        '',
        '## New',
        '',
        '- **SEO:** publish a VideoObject for the films a page actually ships',
        '- **Video:** open the film in a lightbox without shipping a dialog to everyone',
        '- **Video:** let the poster carry the page and download nothing else',
        '- **AI agents:** publish an RFC 9727 API catalog on every tenant site',
        '',
        '## Fixed',
        '',
        '- **CLI:** send the cursor under the name the server itself used',
        '- **AI agents:** type the catalog spec’s helper instead of its default value',
        '- **AI agents:** read the configured brand in the API catalog’s platform entry',
        '- **Video:** read what the DAM now knows instead of the shape it was guessed to have',
        '- **Video:** the lightbox dialog had no accessible name',
        '',
        '## Changed',
        '',
        '- **API:** paginate /api/screen on cursor, keeping the old spelling',
        '',
        '## Documentation',
        '',
        '- **Besigner:** give video its own page, so the catalog stops out-ranking drag-drop',
        '- **Tests:** say what an omitted barrel export costs, without pointing at a note',
        '',
        '## Behind the scenes',
        '',
        '- **Build checks:** lint the staged tools scripts, and write down the tiers',
      ].join('\n'),
    )
  })

  it('counts the release without its own bump commit', () => {
    // Fourteen commits, thirteen changes: the bump is bookkeeping.
    assert.equal(entry.changes, 13)
  })
})

describe('the bump commit, and the release chores that are not it', () => {
  it('drops the bare version bump', () => {
    assert.equal(isVersionBump(commit('b1', 'chore(release): v1.0.0-beta.103 (AGL-2089)')), true)
  })

  it('keeps a release chore that did work', () => {
    // The published beta.103 entry lists this line. Dropping every
    // `chore(release)` swallowed it, and the entry silently lost a change.
    assert.equal(
      isVersionBump(
        commit('b2', 'chore(release): carry the ratchet-row move into the v1.0.0-beta.103 notes (AGL-2089)'),
      ),
      false,
    )
  })
})

describe('what a commit subject becomes', () => {
  it('strips a trailing citation, because the workspace is private', () => {
    assert.equal(
      cleanSummary('the journeys route dropped the check it was handed (AGL-2931)'),
      'the journeys route dropped the check it was handed',
    )
  })

  it('keeps an issue id that is part of the sentence', () => {
    // The published beta.107 entry carries this line verbatim. Stripping ids
    // anywhere left "raise the Linear ceiling to , read from the workspace".
    assert.equal(
      cleanSummary('raise the Linear ceiling to AGL-2718, read from the workspace (AGL-2718)'),
      'raise the Linear ceiling to AGL-2718, read from the workspace',
    )
  })

  it('writes American spelling, by word and not by rule', () => {
    assert.equal(
      cleanSummary('move the colour ratchet row with the code it counts (AGL-2710)'),
      'move the color ratchet row with the code it counts',
    )
    // `-ise` → `-ize` as a RULE would mangle these; the shared word list is
    // why they survive.
    assert.equal(americanize('advertise the enterprise franchise'), 'advertise the enterprise franchise')
  })

  it('does not put the founder in the site copy', () => {
    assert.equal(
      cleanSummary("restore Zach's staff claim after the rotation (AGL-2222)"),
      "restore the owner's staff claim after the rotation",
    )
  })

  it('names a scope the way the site does, and an unmapped one plainly', () => {
    assert.equal(areaFor(commit('c1', 'fix(tenant): a thing')), 'Sites')
    assert.equal(areaFor(commit('c2', 'fix(dam): a thing')), 'Media library')
    assert.equal(areaFor(commit('c3', 'fix(api-v1): a thing')), 'REST API')
    // Several scopes: filed under the first, which is the one that led.
    assert.equal(areaFor(commit('c4', 'fix(console,docs): a thing')), 'Console')
    // No row yet: its own spelling rather than a catch-all, so the next
    // release shows the name that needs choosing.
    assert.equal(areaFor(commit('c5', 'fix(widget-forge): a thing')), 'Widget forge')
    assert.equal(areaFor(commit('c6', 'fix: a thing with no scope at all')), 'Platform')
  })
})

describe('the excerpt', () => {
  it('states a single change and stops', () => {
    // "1 changes in all: 1 fix" is a robot talking.
    assert.equal(
      renderExcerpt([commit('d1', 'fix(health): the journeys route dropped the check it was handed')]),
      'The journeys route dropped the check it was handed.',
    )
  })

  it('leads with what a subscriber got, not with the tooling above it', () => {
    // Exactly the published beta.116 shape: an ffmpeg tooling commit sorts
    // first and the entry still leads with the media CDN.
    const excerpt = renderExcerpt([
      commit('e1', 'feat(tools): produce video renditions with ffmpeg, for nothing a month'),
      commit('e2', 'feat(media-cdn): serve a video’s poster and renditions, and keep the edge verdict'),
    ])
    assert.match(excerpt, /^Serve a video’s poster and renditions, and keep the edge verdict\./)
  })

  it('falls back to the internal change when that is all there was', () => {
    const excerpt = renderExcerpt([
      commit('f1', 'ci(main): stop tuning the cron — editing it is what starves it'),
    ])
    assert.equal(excerpt, 'Stop tuning the cron — editing it is what starves it.')
  })
})

describe('the sections', () => {
  it('prints in the order the published entries print them', () => {
    const sections = sectionsFor([
      commit('g1', 'docs(api): a note'),
      commit('g2', 'chore(tools): a chore'),
      commit('g3', 'fix(console): a fix'),
      commit('g4', 'perf(tenant): a speedup'),
      commit('g5', 'feat(crm): a feature'),
      commit('g6', 'refactor(aglyn): a move'),
      commit('g7', 'revert(theme): a revert'),
    ])
    assert.deepEqual(
      sections.map((section) => section.heading),
      ['New', 'Fixed', 'Performance', 'Reverted', 'Changed', 'Documentation', 'Behind the scenes'],
    )
  })

  it('lists a subject that shipped again as its own change', () => {
    // Two releases really did raise the ceiling with the same sentence.
    // De-duplicating by text deleted the second release's only work.
    const repeated = [
      commit('h1', 'chore(tools): raise the Linear ceiling to the newest issue that exists'),
      commit('h2', 'chore(tools): raise the Linear ceiling to the newest issue that exists'),
    ]
    assert.equal(sectionsFor(repeated)[0].commits.length, 2)
  })

  it('files an unconventional subject rather than dropping it', () => {
    // The early history predates the convention, and it still shipped.
    const sections = sectionsFor([commit('i1', 'Separation from brainstorming repo on BitBucket')])
    assert.equal(sections[0].heading, 'Behind the scenes')
  })
})

describe('the notes a release carries', () => {
  it('says when it is carrying a version that never served', () => {
    const entry = renderReleaseEntry({
      version: '1.0.0-beta.6',
      commits: [commit('j1', 'fix(console): a fix')],
      servedAt: '2026-08-20T01:21:00Z',
      ref: 'v1.0.0-beta.6',
      previousRef: 'v1.0.0-beta.4',
      carriedVersions: ['1.0.0-beta.5'],
    })
    assert.match(
      entry.body,
      /The tree cut as v1\.0\.0-beta\.5 never reached production, so its changes ship here\./,
    )
  })

  it('names the numbers cut but never promoted on their own', () => {
    const entry = renderReleaseEntry({
      version: '1.0.0-beta.62',
      commits: [commit('k1', 'fix(console): a fix')],
      servedAt: '2026-09-02T12:00:00Z',
      ref: 'v1.0.0-beta.62',
      previousRef: 'v1.0.0-beta.59',
      skippedVersions: ['1.0.0-beta.60', '1.0.0-beta.61'],
    })
    assert.match(
      entry.body,
      /It also carries the changes cut as v1\.0\.0-beta\.60 and v1\.0\.0-beta\.61\./,
    )
  })

  it('says when one number took more than one deploy', () => {
    const entry = renderReleaseEntry({
      version: '1.0.0-beta.18',
      commits: [commit('l1', 'fix(console): a fix')],
      servedAt: '2026-08-25T09:00:00Z',
      deployedAt: ['2026-08-25T09:00:00Z', '2026-08-25T14:30:00Z'],
      ref: 'v1.0.0-beta.18',
      previousRef: 'v1.0.0-beta.17',
    })
    assert.match(
      entry.body,
      /This version reached production in 2 deploys; the last landed on August 25, 2026 at 14:30 UTC\./,
    )
  })

  it('compares against a SHA when no tag was cut', () => {
    // A tag gap is usually the honest record — a version cut and never
    // promoted — so the link names the commit rather than a tag that 404s.
    const entry = renderReleaseEntry({
      version: '1.0.0-beta.109',
      commits: [commit('m1', 'fix(console): a fix')],
      servedAt: '2026-09-10T04:11:00Z',
      ref: 'v1.0.0-beta.109',
      previousRef: '0049273ece55',
    })
    assert.match(
      entry.body,
      /compare\/0049273ece55\.\.\.v1\.0\.0-beta\.109\)/,
    )
  })
})
