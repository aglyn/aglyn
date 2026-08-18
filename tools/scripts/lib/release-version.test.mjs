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
 * Pins the repo versioning rules (AGL-2089).
 *
 *   node --test tools/scripts/lib/release-version.test.mjs
 *
 * THE DANGEROUS FAILURE MODE FOR THIS TOOL IS A NUMBER THAT LOOKS FINE.
 * A wrong bump does not throw — it prints a plausible version, gets tagged,
 * and then the tag series lies about what shipped forever after. Every case
 * below is written from that direction: the assertions are about the bumps
 * that must NOT happen (a `docs`-only batch minting a minor, a body that
 * merely mentions "BREAKING CHANGE" minting a major, a version going
 * backwards, a prerelease sorting above its release).
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  assertForward,
  CHANGELOG_MARKER,
  compareVersions,
  extractLinearIds,
  formatVersion,
  insertRelease,
  maxBump,
  nextVersion,
  parseCommit,
  parseVersion,
  renderRelease,
  summarizeCommits,
  tagForVersion,
  versionForTag,
} from './release-version.mjs'

const commit = (subject, body = '', sha = 'abc1234') => ({ sha, subject, body })

describe('parseCommit', () => {
  it('classifies the types that cause a release', () => {
    assert.equal(
      parseCommit(commit('feat(console): add a thing')).bump,
      'minor',
    )
    assert.equal(parseCommit(commit('fix(tenant): fix a thing')).bump, 'patch')
    assert.equal(parseCommit(commit('perf(besigner): faster')).bump, 'patch')
    assert.equal(parseCommit(commit('revert: undo the thing')).bump, 'patch')
  })

  it('gives NO bump to the types that only ride a release', () => {
    // The false-minor risk: a 30-commit docs/test batch must not mint a minor
    // just because it is large. Size is not significance.
    for (const type of [
      'docs',
      'test',
      'chore',
      'ci',
      'style',
      'build',
      'refactor',
    ]) {
      assert.equal(
        parseCommit(commit(`${type}(scope): something`)).bump,
        'none',
        `${type} must not cause a release on its own`,
      )
    }
  })

  it('reads both breaking-change signals', () => {
    assert.equal(parseCommit(commit('feat(api)!: drop v1')).bump, 'major')
    assert.equal(
      parseCommit(commit('chore(www)!: delete apps/www')).bump,
      'major',
    )
    assert.equal(
      parseCommit(commit('feat(api): v2', 'BREAKING CHANGE: v1 is gone')).bump,
      'major',
    )
    // The hyphenated spelling is also spec-legal.
    assert.equal(
      parseCommit(commit('feat(api): v2', 'BREAKING-CHANGE: v1 is gone')).bump,
      'major',
    )
  })

  it('does NOT mint a major from prose merely mentioning a breaking change', () => {
    // The expensive false positive. A body explaining that something is *not*
    // breaking must not trip the footer matcher, so the match is line-anchored.
    const parsed = parseCommit(
      commit(
        'fix(console): guard the migration',
        'This is deliberately not a BREAKING CHANGE: the old field still reads.',
      ),
    )
    assert.equal(parsed.breaking, false)
    assert.equal(parsed.bump, 'patch')
  })

  it('marks unparseable commits rather than guessing at them', () => {
    const merge = parseCommit(commit('Merge pull request #860 from aglyn/main'))
    assert.equal(merge.conventional, false)
    assert.equal(merge.bump, 'none')

    // A type outside commitlint's enum is not conventional here either —
    // otherwise a typo like `feats:` would silently become a `none` that reads
    // as intentional.
    const typo = parseCommit(commit('feats(console): add a thing'))
    assert.equal(typo.conventional, false)
    assert.equal(typo.bump, 'none')
  })

  it('keeps the Linear ids, which are the link back to the record', () => {
    const parsed = parseCommit(
      commit('fix(console): the tenant apex is configuration (AGL-2022)'),
    )
    assert.deepEqual(parsed.linearIds, ['AGL-2022'])

    assert.deepEqual(
      parseCommit(commit('docs(legal): v6 recaptured (AGL-1987, AGL-1992)'))
        .linearIds,
      ['AGL-1987', 'AGL-1992'],
    )
    // Ids in the body count too, and duplicates collapse.
    assert.deepEqual(extractLinearIds('fix: a (AGL-1) \n\nRefs AGL-2, AGL-1'), [
      'AGL-1',
      'AGL-2',
    ])
  })

  it('parses a real subject from this repo', () => {
    const parsed = parseCommit(
      commit(
        'fix(console,billing): metered storage bills by default; the cap is the customer’s (AGL-1886)',
      ),
    )
    assert.equal(parsed.conventional, true)
    assert.equal(parsed.type, 'fix')
    assert.equal(parsed.scope, 'console,billing')
    assert.deepEqual(parsed.linearIds, ['AGL-1886'])
  })
})

describe('maxBump / summarizeCommits', () => {
  it('takes the strongest bump in the batch, not the last or the commonest', () => {
    assert.equal(maxBump(['patch', 'none', 'minor', 'patch']), 'minor')
    assert.equal(maxBump(['none', 'major', 'minor']), 'major')
    assert.equal(maxBump([]), 'none')
  })

  it('one feat among ninety-two chores still makes it a minor', () => {
    const batch = [
      ...Array.from({ length: 92 }, (_, i) => commit(`chore(x): tidy ${i}`)),
      commit('feat(console): the new thing (AGL-1)'),
    ]
    const summary = summarizeCommits(batch)
    assert.equal(summary.bump, 'minor')
    assert.equal(summary.total, 93)
  })

  it('reports unconventional commits instead of hiding them', () => {
    const summary = summarizeCommits([
      commit('fix(a): x (AGL-1)'),
      commit('Merge pull request #860 from aglyn/main'),
    ])
    assert.equal(summary.unconventional, 1)
    assert.equal(summary.bump, 'patch')
    assert.equal(summary.byType['(unconventional)'], 1)
  })
})

describe('parseVersion / formatVersion', () => {
  it('round-trips the shapes this repo uses', () => {
    for (const v of ['1.0.0-alpha.0', '1.0.0-beta.1', '1.0.0', '2.13.4']) {
      assert.equal(formatVersion(parseVersion(v)), v)
    }
  })

  it('refuses shapes whose ordering would be ambiguous', () => {
    // A bare prerelease tag with no number cannot be incremented, and build
    // metadata does not participate in precedence — both would make "is this
    // ahead of that" unanswerable, so neither is accepted.
    for (const bad of [
      '1.0.0-beta',
      '1.0.0+build.5',
      '1.0',
      'v1.0.0',
      '01.0.0',
      '',
    ]) {
      assert.throws(() => parseVersion(bad), /Not a version this repo can bump/)
    }
  })
})

describe('compareVersions', () => {
  it('orders a prerelease BELOW the release it precedes', () => {
    // The rule most often gotten backwards, and the one assertForward relies
    // on to refuse a backward move.
    assert.ok(compareVersions('1.0.0-beta.1', '1.0.0') < 0)
    assert.ok(compareVersions('1.0.0', '1.0.0-beta.1') > 0)
    assert.ok(compareVersions('1.0.0-alpha.0', '1.0.0-beta.1') < 0)
    assert.ok(compareVersions('1.0.0-beta.2', '1.0.0-beta.10') < 0)
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
    assert.ok(compareVersions('1.9.0', '1.10.0') < 0)
  })
})

describe('nextVersion — prerelease series', () => {
  it('increments the series number and leaves the base alone', () => {
    // During a beta the base states what GA will be. A feat landing in beta
    // does not change that intent, so it must not silently rewrite the base.
    for (const bump of ['none', 'patch', 'minor', 'major']) {
      assert.equal(
        formatVersion(nextVersion('1.0.0-beta.3', bump)),
        '1.0.0-beta.4',
        `${bump} must not move the base during a prerelease series`,
      )
    }
  })

  it('restarts the series at .1 when the tag changes', () => {
    assert.equal(
      formatVersion(
        nextVersion('1.0.0-alpha.0', 'minor', { prereleaseTag: 'beta' }),
      ),
      '1.0.0-beta.1',
    )
    // and that really is a forward move
    assert.ok(compareVersions('1.0.0-beta.1', '1.0.0-alpha.0') > 0)
  })
})

describe('nextVersion — release series', () => {
  it('applies ordinary semver', () => {
    assert.equal(formatVersion(nextVersion('1.2.3', 'major')), '2.0.0')
    assert.equal(formatVersion(nextVersion('1.2.3', 'minor')), '1.3.0')
    assert.equal(formatVersion(nextVersion('1.2.3', 'patch')), '1.2.4')
  })

  it('still produces a patch when nothing was user-facing', () => {
    // Two different deployed artifacts must never carry the same version.
    assert.equal(formatVersion(nextVersion('1.2.3', 'none')), '1.2.4')
  })

  it('zeroes the lower parts', () => {
    assert.equal(formatVersion(nextVersion('1.9.7', 'major')), '2.0.0')
    assert.equal(formatVersion(nextVersion('1.9.7', 'minor')), '1.10.0')
  })

  it('rejects a bump level it does not know', () => {
    assert.throws(() => nextVersion('1.0.0', 'huge'), /Unknown bump level/)
  })
})

describe('assertForward', () => {
  it('refuses to re-cut or move backwards', () => {
    // The guard that makes an explicit `--set` safe to expose.
    assert.throws(() => assertForward('1.2.3', '1.2.3'), /not ahead of/)
    assert.throws(() => assertForward('1.2.3', '1.2.2'), /not ahead of/)
    assert.throws(() => assertForward('1.0.0', '1.0.0-beta.9'), /not ahead of/)
    assert.doesNotThrow(() => assertForward('1.0.0-beta.9', '1.0.0'))
    assert.doesNotThrow(() => assertForward('1.0.0-alpha.0', '1.0.0-beta.1'))
  })
})

describe('tagForVersion / versionForTag', () => {
  it('round-trips and ignores tags that are not ours', () => {
    assert.equal(tagForVersion('1.0.0-beta.1'), 'v1.0.0-beta.1')
    assert.equal(versionForTag('v1.0.0-beta.1'), '1.0.0-beta.1')
    // The two 2021 tags in this repo must never be read as a release version.
    assert.equal(versionForTag('sdk-framework-0.0.1'), null)
    assert.equal(versionForTag('website-core-0.0.1'), null)
  })
})

describe('renderRelease', () => {
  const summary = summarizeCommits([
    commit('feat(console): usage alerts (AGL-100)'),
    commit('fix(tenant): the apex is configuration (AGL-2022)'),
    commit('docs(legal): v6 recaptured (AGL-1987, AGL-1992)'),
    commit('test(console): null-mock the card (AGL-1557)'),
    commit('chore(deps): bump a thing'),
    commit('Merge pull request #860 from aglyn/main'),
  ])

  const rendered = renderRelease({
    version: '1.0.0-beta.1',
    date: '2026-08-18',
    summary,
  })

  it('preserves and links every Linear id', () => {
    for (const id of [
      'AGL-100',
      'AGL-2022',
      'AGL-1987',
      'AGL-1992',
      'AGL-1557',
    ]) {
      assert.ok(
        rendered.includes(`https://linear.app/aglyn/issue/${id}`),
        `${id} must survive into the changelog — it is the link back to the record`,
      )
    }
  })

  it('does not leave the raw id suffix in the prose', () => {
    // The id is printed as a link, so `AGL-2022` legitimately appears twice on
    // the line (label + href). What must NOT survive is the bare `(AGL-2022)`
    // suffix from the subject, which would render as a doubled id.
    const line = rendered
      .split('\n')
      .find((l) => l.includes('the apex is configuration'))
    assert.ok(line)
    assert.ok(!line.includes('configuration (AGL-2022)'))
    assert.equal(
      line,
      '- **tenant:** the apex is configuration ([AGL-2022](https://linear.app/aglyn/issue/AGL-2022))',
    )
  })

  it('sections the user-facing work and collapses the quiet types', () => {
    assert.ok(rendered.includes('### Added'))
    assert.ok(rendered.includes('### Fixed'))
    assert.ok(rendered.includes('### Documentation'))
    assert.ok(
      /<summary>Also in this release: 1 test, 1 chore<\/summary>/.test(
        rendered,
      ),
    )
    assert.ok(rendered.includes('</details>'))
  })

  it('keeps the quiet types COLLAPSED, never dropped', () => {
    // The regression this guards: folding test/chore into a bare count threw
    // away their Linear ids. AGL-1557 rides a `test(console)` commit here and
    // must still be reachable.
    assert.ok(rendered.includes('null-mock the card'))
    assert.ok(rendered.includes('https://linear.app/aglyn/issue/AGL-1557'))
  })

  it('discloses the commits it could not classify', () => {
    // Silence here would mean the reader cannot tell whether the bump was
    // computed over the whole batch.
    assert.ok(/1 commit\(s\) did not parse/.test(rendered))
  })

  it('puts breaking changes first, under their own heading', () => {
    const breaking = renderRelease({
      version: '2.0.0',
      date: '2026-09-01',
      summary: summarizeCommits([
        commit('feat(api)!: drop v1 (AGL-9)'),
        commit('fix(a): x (AGL-8)'),
      ]),
    })
    assert.ok(
      breaking.indexOf('### Breaking changes') < breaking.indexOf('### Fixed'),
    )
    // and it is listed once, under Breaking changes only
    assert.equal(breaking.match(/drop v1/g).length, 1)
  })
})

describe('insertRelease', () => {
  it('creates the file with a header when there is none, newest first', () => {
    const first = insertRelease(
      '',
      renderRelease({
        version: '1.0.0-beta.1',
        date: '2026-08-18',
        summary: summarizeCommits([commit('fix(a): one (AGL-1)')]),
      }),
    )
    assert.ok(first.startsWith('# Changelog'))
    assert.ok(first.includes(CHANGELOG_MARKER))
    assert.ok(first.includes('v1.0.0-beta.1'))

    const second = insertRelease(
      first,
      renderRelease({
        version: '1.0.0-beta.2',
        date: '2026-08-19',
        summary: summarizeCommits([commit('fix(b): two (AGL-2)')]),
      }),
    )
    // Newest first, and the older release survives.
    assert.ok(second.indexOf('v1.0.0-beta.2') < second.indexOf('v1.0.0-beta.1'))
    assert.ok(second.includes('AGL-1'))
    // Exactly one header.
    assert.equal(second.match(/^# Changelog$/gm).length, 1)
  })
})
