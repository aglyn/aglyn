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

// The pure half of repo versioning (AGL-2089). No git, no fs, no network —
// strings in, strings out — so every rule below is testable without a
// repository, which is the only reason the self-test can prove the dangerous
// cases (see release-version.test.mjs).
//
// WHAT IS VERSIONED, AND WHY IT IS ONE NUMBER
//
// One version for the whole repo. Not per-app, not per-lib:
//
//   - NOTHING HERE IS PUBLISHED. All 40+ `@aglyn/*` libs sit at the nx
//     scaffold default `0.0.1`, and the `@aglyn` npm scope is unregistered —
//     `npm view @aglyn/aglyn` is a 404. Changesets and `nx release` both exist
//     to coordinate versions of packages that go to a REGISTRY. There is no
//     registry. Their per-package bookkeeping would be pure ceremony, and
//     `nx release` under `projectsRelationship: fixed` would rewrite 60+
//     package.json files per release to numbers nobody can install.
//   - ONE SHA SHIPS EVERYTHING. Only the `production` branch deploys
//     (docs/VERCEL_DEPLOYMENTS.md, AGL-522), and console + tenant + docs all
//     build from that one commit. Three app versions off one SHA would be
//     three names for the same artifact.
//
// So: the version names A DEPLOYED COMMIT OF THIS REPO. That is also exactly
// what a self-host operator needs — they run the whole repo as one unit.
//
// THE BUMP IS NOT AUTOMATIC, AND MUST NOT BE
//
// `main` moves constantly under many agents. A version bump per commit would
// collide on every push and would version things that never shipped. The bump
// is a DELIBERATE step in the main→production promotion, run by a human at the
// point the batch is being promoted. This file only computes what the next
// version WOULD be; deciding to cut it is a separate act.

/** The commit types commitlint accepts (commitlint.config.js `type-enum`). */
export const COMMIT_TYPES = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
]

/** Bump levels, weakest first. Index order IS the precedence order. */
export const BUMP_LEVELS = ['none', 'patch', 'minor', 'major']

/**
 * Types that produce a user-visible change and therefore justify a release on
 * their own. Everything else (docs/test/chore/ci/style/build/refactor) is
 * `none` — it can RIDE a release but never causes one.
 *
 * `revert` is a patch: reverting a feat is a behaviour change users see.
 */
const PATCH_TYPES = new Set(['fix', 'perf', 'revert'])

const SUBJECT_RE =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s*(?<summary>.+)$/

/** Every `AGL-1234` in a string, de-duplicated, in first-seen order. */
export function extractLinearIds(text) {
  const ids = []
  for (const [id] of String(text ?? '').matchAll(/\bAGL-\d+\b/g)) {
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Parse one commit into the fields the bump and the changelog both need.
 *
 * A subject that does not match conventional-commit shape, or whose type is
 * not in COMMIT_TYPES, is returned with `conventional: false` and bump
 * `none`. It is NOT an error: merge commits ("Merge pull request #860 from
 * aglyn/main") and the 2021 history are both unparseable, and a release must
 * not be blocked by them. They are reported, not silently eaten — see
 * summarizeCommits().
 */
export function parseCommit({ sha = '', subject = '', body = '' } = {}) {
  const match = SUBJECT_RE.exec(subject.trim())
  const linearIds = extractLinearIds(`${subject}\n${body}`)

  if (!match || !COMMIT_TYPES.includes(match.groups.type)) {
    return {
      sha,
      subject,
      conventional: false,
      type: null,
      scope: null,
      summary: subject.trim(),
      breaking: false,
      bump: 'none',
      linearIds,
    }
  }

  const { type, scope, breaking, summary } = match.groups

  // Two independent breaking-change signals, both from the Conventional
  // Commits spec. The footer form is checked with a line anchor so a body
  // merely MENTIONING the phrase mid-sentence does not silently ship a major.
  const breakingFooter = /^BREAKING[ -]CHANGE:\s/m.test(body ?? '')
  const isBreaking = Boolean(breaking) || breakingFooter

  let bump = 'none'
  if (isBreaking) bump = 'major'
  else if (type === 'feat') bump = 'minor'
  else if (PATCH_TYPES.has(type)) bump = 'patch'

  return {
    sha,
    subject,
    conventional: true,
    type,
    scope: scope ?? null,
    summary: summary.trim(),
    breaking: isBreaking,
    bump,
    linearIds,
  }
}

/** The strongest bump among `levels`. Empty ⇒ 'none'. */
export function maxBump(levels) {
  let best = 0
  for (const level of levels) {
    const index = BUMP_LEVELS.indexOf(level)
    if (index > best) best = index
  }
  return BUMP_LEVELS[best]
}

/**
 * Fold a list of raw commits into the release-relevant summary: the parsed
 * commits, the aggregate bump, and the counts a human needs to sanity-check
 * the number before cutting it.
 */
export function summarizeCommits(rawCommits) {
  const commits = rawCommits.map(parseCommit)
  const byType = {}
  for (const commit of commits) {
    const key = commit.conventional ? commit.type : '(unconventional)'
    byType[key] = (byType[key] ?? 0) + 1
  }
  return {
    commits,
    bump: maxBump(commits.map((c) => c.bump)),
    total: commits.length,
    unconventional: commits.filter((c) => !c.conventional).length,
    breaking: commits.filter((c) => c.breaking),
    linearIds: extractLinearIds(
      commits.map((c) => c.linearIds.join(' ')).join(' '),
    ),
    byType,
  }
}

// ---------------------------------------------------------------------------
// Semver
// ---------------------------------------------------------------------------

// Deliberately narrower than full semver: `MAJOR.MINOR.PATCH` with an optional
// `-<tag>.<n>` prerelease and nothing else. No build metadata, no bare
// prerelease tags. A repo version is written by this tool and read by humans
// and by self-host operators comparing upgrades; a shape that cannot express
// `1.0.0-beta` (no number) is a shape whose ordering is never ambiguous.
const VERSION_RE =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<tag>[a-z][a-z0-9]*)\.(?<num>0|[1-9]\d*))?$/

export function parseVersion(input) {
  const match = VERSION_RE.exec(String(input ?? '').trim())
  if (!match) {
    throw new Error(
      `Not a version this repo can bump: ${JSON.stringify(input)}. ` +
        `Expected MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-tag.N (e.g. 1.0.0-beta.1).`,
    )
  }
  const { major, minor, patch, tag, num } = match.groups
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: tag ? { tag, num: Number(num) } : null,
  }
}

export function formatVersion(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`
  return version.prerelease
    ? `${base}-${version.prerelease.tag}.${version.prerelease.num}`
    : base
}

/**
 * Semver precedence. Returns <0, 0, >0.
 *
 * The rule that matters here and is easy to get backwards: a prerelease has
 * LOWER precedence than the release it precedes — `1.0.0-beta.1` < `1.0.0`.
 * That is what makes `1.0.0-alpha.0` → `1.0.0-beta.1` a forward move and
 * `1.0.0` → `1.0.0-beta.1` a backward one, and the backward case is exactly
 * what assertForward() has to refuse.
 */
export function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a
  const right = typeof b === 'string' ? parseVersion(b) : b

  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1
  }
  if (!left.prerelease && !right.prerelease) return 0
  if (!left.prerelease) return 1
  if (!right.prerelease) return -1
  if (left.prerelease.tag !== right.prerelease.tag) {
    return left.prerelease.tag < right.prerelease.tag ? -1 : 1
  }
  if (left.prerelease.num === right.prerelease.num) return 0
  return left.prerelease.num < right.prerelease.num ? -1 : 1
}

/**
 * The next version, given the current one and an aggregate bump.
 *
 * TWO PHASES, because the repo is in the first one:
 *
 * 1. PRERELEASE SERIES (current version has a prerelease, e.g. `1.0.0-beta.3`)
 *    Each release increments the series number: `beta.3` → `beta.4`. The
 *    commit types do NOT move the base `1.0.0` — during a beta the base is a
 *    statement of intent about what GA will be, and a `feat` landing in beta
 *    does not change that intent. The aggregate bump is still computed and
 *    REPORTED so the operator can see what the batch contained, but it does
 *    not silently rewrite the base. Fake precision is worse than none.
 *
 *    To leave the series, pass an explicit specifier (`--set 1.0.0`). Leaving
 *    a prerelease is a product decision, never an inference from commits.
 *
 * 2. RELEASE SERIES (no prerelease) — ordinary semver:
 *      major → X+1.0.0    minor → X.Y+1.0    patch → X.Y.Z+1
 *
 * `none` in a release series still produces a PATCH. A promotion that reaches
 * production is a release whether or not its commits were user-facing, and two
 * different deployed artifacts must never carry the same version — that is the
 * whole point of the number.
 */
export function nextVersion(currentInput, bump, { prereleaseTag } = {}) {
  const current =
    typeof currentInput === 'string' ? parseVersion(currentInput) : currentInput

  if (!BUMP_LEVELS.includes(bump)) {
    throw new Error(
      `Unknown bump level ${JSON.stringify(bump)}. Expected one of ${BUMP_LEVELS.join(', ')}.`,
    )
  }

  if (current.prerelease) {
    const tag = prereleaseTag ?? current.prerelease.tag
    // Switching tag (alpha → beta) restarts the series at .1; the tag itself
    // carries the ordering, so continuing the old number would be misleading.
    return tag === current.prerelease.tag
      ? { ...current, prerelease: { tag, num: current.prerelease.num + 1 } }
      : { ...current, prerelease: { tag, num: 1 } }
  }

  const effective = bump === 'none' ? 'patch' : bump
  if (effective === 'major') {
    return { major: current.major + 1, minor: 0, patch: 0, prerelease: null }
  }
  if (effective === 'minor') {
    return {
      major: current.major,
      minor: current.minor + 1,
      patch: 0,
      prerelease: null,
    }
  }
  return {
    major: current.major,
    minor: current.minor,
    patch: current.patch + 1,
    prerelease: null,
  }
}

/**
 * Refuse a version that is not strictly ahead of the current one.
 *
 * This is the guard that makes `--set` safe to expose. Re-cutting a version,
 * or moving backwards, would point two different deployed SHAs at one number
 * and make the tag series lie about what shipped.
 */
export function assertForward(current, next) {
  if (compareVersions(next, current) <= 0) {
    throw new Error(
      `Refusing to release ${formatVersion(typeof next === 'string' ? parseVersion(next) : next)}: ` +
        `it is not ahead of the current version ${formatVersion(typeof current === 'string' ? parseVersion(current) : current)}. ` +
        `A version must only ever move forward — two deployed commits must never share a number.`,
    )
  }
}

/** The git tag for a version. One place, so the writer and reader agree. */
export function tagForVersion(version) {
  return `v${typeof version === 'string' ? version : formatVersion(version)}`
}

/** Inverse of tagForVersion; null when `tag` is not one of ours. */
export function versionForTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) return null
  try {
    return formatVersion(parseVersion(tag.slice(1)))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

/** Section order and headings. Types absent here never get a section. */
const SECTIONS = [
  ['feat', 'Added'],
  ['fix', 'Fixed'],
  ['perf', 'Performance'],
  ['revert', 'Reverted'],
  ['refactor', 'Changed'],
  ['docs', 'Documentation'],
]

/**
 * Types that go into the collapsed section rather than a headed one.
 *
 * They are COLLAPSED, not dropped. An earlier cut folded them into a bare
 * count ("also: 12 test, 4 chore") and the self-test caught what that costs:
 * every Linear id on those commits disappears, and those ids are the link back
 * to the record of why the work happened. A `<details>` block keeps all of
 * them addressable while keeping ninety chore lines out of the reader's way.
 */
const QUIET_TYPES = new Set(['test', 'chore', 'ci', 'style', 'build'])

const linkForId = (id) => `[${id}](https://linear.app/aglyn/issue/${id})`

/**
 * Render one release's changelog section as Markdown.
 *
 * The Linear ids are the point. They are in the subject line of nearly every
 * commit and they are the link back to the record of WHY — so they are pulled
 * out and linked rather than left as bare text, and the summary keeps the id
 * suffix stripped so the line reads as prose.
 */
export function renderRelease({ version, date, summary, compareUrl } = {}) {
  const heading = `## ${tagForVersion(version)} — ${date}`
  const lines = [heading, '']

  if (compareUrl) {
    lines.push(`[Compare with the previous release](${compareUrl})`, '')
  }

  if (summary.breaking.length > 0) {
    lines.push('### Breaking changes', '')
    for (const commit of summary.breaking) {
      lines.push(renderCommitLine(commit))
    }
    lines.push('')
  }

  for (const [type, title] of SECTIONS) {
    const matching = summary.commits.filter(
      (c) => c.conventional && c.type === type && !c.breaking,
    )
    if (matching.length === 0) continue
    lines.push(`### ${title}`, '')
    for (const commit of matching) lines.push(renderCommitLine(commit))
    lines.push('')
  }

  const quiet = summary.commits.filter(
    (c) => c.conventional && QUIET_TYPES.has(c.type),
  )
  if (quiet.length > 0) {
    const breakdown = [...QUIET_TYPES]
      .map((type) => [type, quiet.filter((c) => c.type === type).length])
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ')
    lines.push(
      '<details>',
      `<summary>Also in this release: ${breakdown}</summary>`,
      '',
    )
    for (const commit of quiet) lines.push(renderCommitLine(commit))
    lines.push('', '</details>', '')
  }

  const notes = []
  if (summary.unconventional > 0) {
    // Never hidden. An unconventional commit is one this tool could not
    // classify, so its contribution to the bump was zero — the reader has to
    // know that happened to judge whether the number is right.
    notes.push(
      `${summary.unconventional} commit(s) did not parse as conventional commits ` +
        `(merge commits and the like) and did not contribute to the version bump.`,
    )
  }
  if (notes.length > 0) lines.push(notes.join(' '), '')

  return lines.join('\n')
}

function renderCommitLine(commit) {
  // Strip a trailing `(AGL-1, AGL-2)` so the ids are not printed twice.
  const summary = commit.summary
    .replace(/\s*\((?:AGL-\d+(?:,\s*)?)+\)\s*$/, '')
    .trim()
  const scope = commit.scope ? `**${commit.scope}:** ` : ''
  const ids =
    commit.linearIds.length > 0
      ? ` (${commit.linearIds.map(linkForId).join(', ')})`
      : ''
  return `- ${scope}${summary}${ids}`
}

/** The header every CHANGELOG.md carries, and the marker new releases go under. */
export const CHANGELOG_MARKER = '<!-- releases below -->'

export const CHANGELOG_HEADER = `# Changelog

Every released version of the Aglyn platform, newest first. A version names a
commit that was **promoted to \`production\` and verified deployed** — see
[docs/RELEASING.md](docs/RELEASING.md) for how one is cut.

This is the engineering record. The customer-facing changelog is published as
content on the marketing site and is written separately.

${CHANGELOG_MARKER}
`

/**
 * Splice a rendered release into an existing CHANGELOG, newest first.
 *
 * Idempotence is not attempted and must not be: re-releasing the same version
 * is refused upstream by assertForward(), so a duplicate heading here would
 * mean something is already wrong and silently de-duplicating would hide it.
 */
export function insertRelease(existing, rendered) {
  const body = existing?.includes(CHANGELOG_MARKER)
    ? existing
    : CHANGELOG_HEADER
  const index = body.indexOf(CHANGELOG_MARKER) + CHANGELOG_MARKER.length
  return `${body.slice(0, index)}\n\n${rendered.trimEnd()}\n${body.slice(index).replace(/^\n+/, '\n')}`
}
