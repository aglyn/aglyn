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

// Step 3.5 of cutting a release (AGL-3211): publish the release's entry on the
// customer-facing changelog.
//
//   npm run release:changelog                    # report only — writes nothing
//   npm run release:changelog -- --write
//   npm run release:changelog -- --version 1.0.0-beta.144 --write
//
// `release-tag.mjs --write --push` calls this for you, because the tag is the
// moment the claim "this tree was built AND served" becomes true, and that is
// exactly the claim an entry makes. Run it by hand to backfill one that was
// missed, or after fixing whatever made the write fail.
//
// WHY THE CHANGELOG IS NOT CHANGELOG.md
//
// `CHANGELOG.md` is cut on `main` at bump time, so it records what a batch was
// MEANT to contain. Two things then make it a poor customer record: a batch can
// be superseded before it promotes (the file keeps the section anyway), and a
// promoted tree can fail to build on Vercel and never serve a user —
// v1.0.0-beta.5 is the worked example, and its section is still in the file.
//
// The site's changelog answers the other question: what reached users, and
// when. So this script derives its content from `origin/production` and its
// DATE from GitHub's deployment records, and it refuses to write an entry for
// a version whose console and tenant deployments did not both succeed.
//
// WHY IT WRITES THE COLLECTION DIRECTLY
//
// The marketing site's charter says the site is built by clicking, like a
// subscriber would (docs/MARKETING_SITE.md). Authoring 125 entries by hand is
// how AGL-2848 started and it is not a thing a release should wait on, so the
// owner lifted that rule for the changelog specifically: this writes the same
// document the console's entry editor writes, with the same fields, and the
// console remains the place they are edited afterwards.

import { execFileSync } from 'node:child_process'

import { cert, applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'

import { changelogEntryId, renderReleaseEntry } from './lib/changelog-entry.mjs'
import {
  compareVersions,
  parseCommit,
  parseVersion,
} from './lib/release-version.mjs'

/** The marketing site host, and the collection the entries live in. */
const DEFAULT_HOST = 'DXnRbPH4CQ'
const DEFAULT_COLLECTION = 'changelog'

/** Byline: the company account every version entry is published under. */
const AUTHOR = { authorId: 'JJGzQ74XFz', authorName: 'The Aglyn Team' }

/**
 * The two Vercel projects a release has to reach to have served ANYONE.
 *
 * Console and tenant are the customer-facing pair. `aglyn-docs` and
 * `aglyn-plugins` deploy from the same merge but a release that only reached
 * them changed nothing a subscriber's site does, so they are not part of the
 * verdict.
 */
const SERVING_ENVIRONMENTS = [
  'Production – aglyn-console',
  'Production – aglyn-tenant',
]

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const gitQuiet = (...args) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim()
  } catch {
    return null
  }
}

/**
 * GitHub's REST API, through whichever credential the caller has.
 *
 * A token when one is in the environment (CI has one), the `gh` CLI otherwise
 * (an operator running this at tag time is signed in to it). Both are read
 * paths against a public repository, so neither is privileged.
 */
async function githubJson(path) {
  const token = (process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '').trim()
  if (token) {
    const base = (process.env['GITHUB_API_URL'] ?? 'https://api.github.com').replace(/\/+$/, '')
    const response = await fetch(`${base}/${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub ${path} answered ${response.status}`)
    }
    return response.json()
  }
  return JSON.parse(
    execFileSync('gh', ['api', path], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  )
}

function parseArgs(argv) {
  const options = {
    version: null,
    ref: 'origin/production',
    host: DEFAULT_HOST,
    collection: DEFAULT_COLLECTION,
    window: 40,
    write: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--write') options.write = true
    else if (arg === '--version') options.version = argv[++index]
    else if (arg.startsWith('--version=')) options.version = arg.slice(10)
    else if (arg === '--ref') options.ref = argv[++index]
    else if (arg.startsWith('--ref=')) options.ref = arg.slice(6)
    else if (arg === '--host') options.host = argv[++index]
    else if (arg.startsWith('--host=')) options.host = arg.slice(7)
    else if (arg === '--collection') options.collection = argv[++index]
    else if (arg.startsWith('--collection=')) options.collection = arg.slice(13)
    else if (arg === '--window') options.window = Number(argv[++index])
    else if (arg.startsWith('--window=')) options.window = Number(arg.slice(9))
    else throw new Error(`Unknown argument ${JSON.stringify(arg)}.`)
  }
  if (!Number.isInteger(options.window) || options.window < 2) {
    throw new Error('--window takes a whole number of merges, at least 2.')
  }
  return options
}

/**
 * The version a merge shipped under: the number in its tree, or a higher one
 * from a tag on it.
 *
 * The tag wins when it is higher because a promotion can reach production
 * without its bump — the same tree then serves under the number the tag
 * assigned, and the tag is the record of that.
 */
function labelFor(merge) {
  let label = merge.version
  for (const tag of merge.tags) {
    const tagged = tag.startsWith('v') ? tag.slice(1) : tag
    if (!parseVersion(tagged)) continue
    if (compareVersions(tagged, label) > 0) label = tagged
  }
  return label
}

/** The last `count` promotion merges on production's first-parent line. */
function recentMerges(ref, count) {
  const separator = String.fromCharCode(1)
  const record = String.fromCharCode(2)
  const lines = git(
    'log',
    ref,
    '--first-parent',
    `--max-count=${count}`,
    `--format=%H${separator}%cI`,
  )
    .split('\n')
    .filter(Boolean)

  const merges = []
  for (const line of lines) {
    const [sha, date] = line.split(separator)
    const packageJson = gitQuiet('show', `${sha}:package.json`)
    if (!packageJson) continue
    const version = JSON.parse(packageJson).version
    if (!parseVersion(version)) continue
    const tags = (gitQuiet('tag', '--points-at', sha) ?? '')
      .split('\n')
      .filter(Boolean)
    const commits = git(
      'log',
      '--no-merges',
      `${sha}^1..${sha}`,
      `--format=%H${separator}%s${separator}%b${record}`,
    )
      .split(record)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [commitSha, subject, body = ''] = chunk.split(separator)
        return { sha: commitSha, subject, body }
      })
    merges.push({ sha, date, version, tags, commits })
  }
  // Oldest first: a release is built by walking forward from the previous one.
  return merges.reverse()
}

/**
 * Groups the window's merges into releases the way production actually ran.
 *
 * A merge whose label is higher than everything before it STARTS a release;
 * one whose label is not is a follow-up deploy of the release already open,
 * which is how v1.0.0-beta.18 shipped as three trees under one number.
 */
function groupReleases(merges) {
  const releases = []
  let runningMax = null
  for (const merge of merges) {
    const label = labelFor(merge)
    if (!runningMax || compareVersions(label, runningMax) > 0) {
      releases.push({ version: label, merges: [merge] })
      runningMax = label
    } else {
      releases[releases.length - 1].merges.push(merge)
    }
  }
  return releases
}

/** Every version number between two releases — cut, never promoted alone. */
function skippedBetween(previousVersion, version) {
  const previous = Number(previousVersion.split('.').pop())
  const current = Number(version.split('.').pop())
  const skipped = []
  for (let n = previous + 1; n < current; n += 1) {
    skipped.push(`1.0.0-beta.${n}`)
  }
  return skipped
}

/** When each project first served a sha, per GitHub's deployment records. */
async function servedTimes(sha) {
  const deployments = await githubJson(
    `repos/aglyn/aglyn/deployments?sha=${sha}&per_page=100`,
  )
  const earliest = {}
  for (const deployment of deployments) {
    const environment = deployment?.environment ?? ''
    if (!SERVING_ENVIRONMENTS.includes(environment)) continue
    const statuses = await githubJson(
      `repos/aglyn/aglyn/deployments/${deployment.id}/statuses?per_page=100`,
    )
    for (const status of statuses) {
      if (status?.state !== 'success') continue
      // The EARLIEST success, because a redeploy months later must not re-date
      // a release that has been serving since the day it merged.
      if (!earliest[environment] || status.created_at < earliest[environment]) {
        earliest[environment] = status.created_at
      }
    }
  }
  return earliest
}

/** A release served once BOTH customer-facing projects built from it. */
function servedAtFrom(earliest) {
  const times = SERVING_ENVIRONMENTS.map((environment) => earliest[environment])
  if (times.some((time) => !time)) return null
  return times.reduce((latest, time) => (time > latest ? time : latest))
}

/** The tag if one was cut, the merge sha otherwise — a gap is the record. */
function refFor(release) {
  const tag = `v${release.version}`
  const tagged = release.merges.some((merge) => merge.tags.includes(tag))
  return tagged ? tag : release.merges[release.merges.length - 1].sha.slice(0, 12)
}

/**
 * The zone this site's org publishes in (AGL-3237) — `resolveSiteTimeZone`'s
 * answer, read here rather than imported because this script talks to
 * Firestore with the Admin SDK and the lib that resolves it is browser-safe.
 *
 * Any failure is UTC: no credentials on this machine, an org document that
 * cannot be read, a zone this runtime does not know. The entry still
 * publishes, dated the way every entry before it was.
 */
async function readSiteTimeZone(host) {
  try {
    const database = firestore()
    const hostSnapshot = await database.collection('hosts').doc(host).get()
    const orgId = hostSnapshot.get('orgId')
    if (!orgId) return 'UTC'
    const orgSnapshot = await database.collection('orgs').doc(orgId).get()
    const zone = String(orgSnapshot.get('timeZone') ?? '').trim()
    if (!zone) return 'UTC'
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return 'UTC'
  }
}

function firestore() {
  if (!getApps().length) {
    const clientEmail = process.env['FIREBASE_CLIENT_EMAIL']
    const privateKey = process.env['FIREBASE_PRIVATE_KEY']?.replace(/\\n/g, '\n')
    const projectId = process.env['FIREBASE_PROJECT_ID']
    // The service-account triple when the environment carries it, ADC
    // otherwise — the same two credentials every other tool script accepts.
    initializeApp(
      clientEmail && privateKey && projectId
        ? { credential: cert({ projectId, clientEmail, privateKey }) }
        : { credential: applicationDefault() },
    )
  }
  return getFirestore(process.env['FIRESTORE_DATABASE_ID'])
}

/**
 * Drop the live site's cached listing, the way a publish in the console does.
 *
 * Best effort and deliberately quiet about failure: the entry is written by
 * the time this runs, the page windows underneath are the backstop, and a
 * cache hint that failed must never make a successful publish look failed.
 */
async function revalidate(hostId, subdomain, slug, collectionSlug) {
  const secret = process.env['REVALIDATE_SECRET']
  if (!secret) return 'skipped (no REVALIDATE_SECRET) — the site picks it up when its window expires'
  const origin =
    process.env['TENANT_ORIGIN'] ?? `https://${subdomain}.aglyn.app`
  // The entry and the listing's first page, and nothing else. Listings
  // paginate on a cursor now (AGL-3219), so `/{collection}/page/{n}` is a 301
  // rather than a cached page — and the pages past the first no longer shift
  // when something is published above them, which is the whole reason the
  // positional ones had to be dropped.
  const paths = [`/${collectionSlug}/${slug}`, `/${collectionSlug}`]
  try {
    const response = await fetch(`${origin}/api/revalidate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-revalidate-secret': secret,
      },
      body: JSON.stringify({ host: subdomain, hostId, paths }),
    })
    return response.ok ? `dropped ${paths.length} cached paths` : `answered ${response.status}`
  } catch (error) {
    return `failed: ${error.message}`
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const merges = recentMerges(options.ref, options.window)
  if (!merges.length) {
    throw new Error(
      `No versioned promotion merges on ${options.ref}. Run \`git fetch origin production\` first.`,
    )
  }
  const releases = groupReleases(merges)
  const version =
    options.version ?? releases[releases.length - 1].version
  const index = releases.findIndex((release) => release.version === version)
  if (index === -1) {
    throw new Error(
      `No release ${version} in the last ${options.window} promotion merges. ` +
        `Widen the window with --window <n>.`,
    )
  }
  if (index === 0) {
    throw new Error(
      `${version} is the oldest release in the window, so the release before ` +
        `it is unknown. Widen the window with --window <n>.`,
    )
  }
  const release = releases[index]
  const previous = releases[index - 1]

  const out = []
  out.push('')
  out.push('  Aglyn release — changelog entry')
  out.push('  ' + '-'.repeat(60))
  out.push(`  version         ${version}`)
  out.push(`  merges          ${release.merges.map((merge) => merge.sha.slice(0, 9)).join(', ')}`)

  const deployedAt = []
  for (const merge of release.merges) {
    const servedAt = servedAtFrom(await servedTimes(merge.sha))
    if (servedAt) deployedAt.push(servedAt)
  }
  if (!deployedAt.length) {
    out.push('')
    out.push('  REFUSED — no deployment of this version has both the console')
    out.push('  and the tenant reporting success, so it has served nobody.')
    out.push('  An entry would claim a release that did not happen.')
    out.push('')
    console.log(out.join('\n'))
    process.exitCode = 1
    return
  }
  deployedAt.sort()

  // A release the window shows as never served is not a release; its changes
  // belong to whoever carried them out, which is this one.
  const carried = []
  const carriedVersions = []
  for (let back = index - 1; back > 0; back -= 1) {
    const candidate = releases[back]
    const servedAt = servedAtFrom(await servedTimes(candidate.merges[0].sha))
    if (servedAt) break
    carried.unshift(...candidate.merges.flatMap((merge) => merge.commits))
    carriedVersions.unshift(candidate.version)
  }

  /*
   * The publishing org's zone (AGL-3237), so the entry's own "Released to
   * production on …" line names the same calendar day the site's index does.
   *
   * Fail-soft to UTC, which is also what a run with no credentials reports:
   * a changelog entry is worth publishing even when the org document cannot
   * be read, and UTC is what the whole archive was written in before this.
   */
  const timeZone = await readSiteTimeZone(options.host)

  const entry = renderReleaseEntry({
    version,
    timeZone,
    commits: [
      ...carried,
      ...release.merges.flatMap((merge) => merge.commits),
    ].map((commit) => parseCommit(commit)),
    servedAt: deployedAt[0],
    deployedAt,
    ref: refFor(release),
    previousRef: refFor(
      carriedVersions.length ? releases[index - 1 - carriedVersions.length] : previous,
    ),
    carriedVersions,
    skippedVersions: skippedBetween(
      (carriedVersions.length ? releases[index - 1 - carriedVersions.length] : previous).version,
      version,
    ).filter((skipped) => !carriedVersions.includes(skipped)),
  })

  out.push(`  served          ${entry.publishedAt}`)
  out.push(`  changes         ${entry.changes}`)
  out.push(`  slug            /${options.collection}/${entry.slug}`)
  out.push('')
  out.push(`  ${entry.excerpt}`)
  out.push('')

  if (!options.write) {
    out.push('  Nothing written. Add --write to publish it.')
    out.push('')
    console.log(out.join('\n'))
    return
  }

  const database = firestore()
  const hostRef = database.collection('hosts').doc(options.host)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) throw new Error(`No host ${options.host}.`)
  const entriesRef = hostRef
    .collection('collections')
    .doc(options.collection)
    .collection('entries')

  // Addressed by SLUG rather than by id, so a re-run after a failed write
  // updates the entry that is already there instead of publishing a second
  // one at a different id.
  const existing = await entriesRef.where('slug', '==', entry.slug).limit(1).get()
  const target = existing.empty
    ? entriesRef.doc(changelogEntryId(entry.slug))
    : existing.docs[0].ref
  const publishedAt = Timestamp.fromDate(new Date(entry.publishedAt))
  await target.set(
    {
      title: entry.title,
      slug: entry.slug,
      excerpt: entry.excerpt,
      body: entry.body,
      status: 'published',
      publishedAt,
      ...AUTHOR,
      seoTitle: '',
      seoDescription: '',
      coverImage: '',
      tags: [],
      ...(existing.empty ? { createdAt: publishedAt } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  out.push(`  ${existing.empty ? 'PUBLISHED' : 'UPDATED'}  ${target.id}`)
  out.push(
    `  cache           ${await revalidate(
      options.host,
      hostSnapshot.data()?.['subdomain'] ?? 'aglyn-marketing',
      entry.slug,
      options.collection,
    )}`,
  )
  out.push('')
  console.log(out.join('\n'))
}

try {
  await main()
} catch (error) {
  console.error(
    `\n  release:changelog refused to continue.\n\n  ${error.message}\n`,
  )
  process.exitCode = 1
}
