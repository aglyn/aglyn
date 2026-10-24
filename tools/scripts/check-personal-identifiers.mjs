#!/usr/bin/env node
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
 * Fails if a named individual's account identifiers reappear in tracked source.
 *
 *   npm run check:personal-identifiers
 *
 * ## Why this exists, and why the guards already here did not catch it
 *
 * This repository is PUBLIC. One person's work mailbox reached **60 tracked
 * files**: shipped source comments, twenty-five spec fixtures, six operational
 * runbooks and two published documentation pages. A personal consumer Google
 * account was named on `docs.aglyn.com` as the permanent `super` break-glass
 * identity — which is to say, published as the one account outside Workspace
 * MFA, offboarding and session revocation. A production Firebase uid for a real
 * person sat in eight files as a test fixture.
 *
 * Three guards were already watching adjacent things and every one of them was
 * green:
 *
 *  - `check-contact-addresses` reads `@aglyn.com` addresses, but it EXEMPTS
 *    every `*.spec.*`, `*.test.*` and `specs/` path — fixtures name people, and
 *    that exemption is right for its own question. It is why twenty-five spec
 *    files were invisible. It also carried a standing exemption for the
 *    owner's local-part, since removed.
 *  - `check-no-tax-identifiers` guards Comptroller registration numbers.
 *  - `check-residential-address` guards one street address.
 *
 * Each is narrow by design. Nothing owned "an identifier belonging to a
 * person", so nothing failed, for months, while the count grew.
 *
 * ## Why it matches by digest and not by grep
 *
 * Same reasoning as `check-no-tax-identifiers`, and it is not about secrecy —
 * these values are not credentials, and they are already in this repository's
 * git history where no guard can reach them. It is that a guard which spells
 * out the literal it forbids is itself a tracked file containing that literal.
 * It would re-add, in the fixing commit, one instance of every value it exists
 * to remove, and be exempted from itself forever after.
 *
 * So it matches by SHAPE — an address, a Firebase uid, a home-directory path —
 * and compares SHA-256 digests. False positives from the shape match are free:
 * an ordinary address hashes to something else and is ignored.
 *
 * ## Client identifiers: the private list, matched as words
 *
 * The second class is a client's: a business name, the people in it, its
 * workspace slug and site host, its phone number, its org and host ids. They
 * reached about fifty tracked files as fixtures, comments and a production
 * canary's page list, and the shapes above could see none of them, because a
 * name has no shape. So the terms live in a PRIVATE list on the operator's
 * machine, never in this repository, and the guard holds only their digests
 * (`check-personal-identifiers.client-digests.json`, beside this file).
 *
 * Text is folded to lower case and split into words on everything that is not
 * a letter or a digit. Every run of one to three words is a candidate twice:
 * joined by a space, and joined by nothing. A term is normalized the same way
 * (lower case, split on non-alphanumerics, joined by a space) and digested in
 * both forms. "Joined by nothing" is what catches a slug, an identifier and a
 * host: `acme-builders`, `acmeBuilders`, `acme_builders`, `acmebuilders` and
 * `acmebuilders.aglyn.app` all name "acme builders". One rule on top of words:
 * an all-digit candidate of 8 or more digits is also checked by its last 10 and
 * last 7 digits, so `+15550100199` matches a listed `555-010-0199` and a
 * listed 7-digit local number matches inside a full one.
 *
 * Every candidate passes a fast non-cryptographic prefilter first, and only a
 * prefilter hit is confirmed with SHA-256. Without the prefilter the sweep
 * would hash tens of millions of candidates; with it, a handful. The
 * prefilter is a 32-bit polynomial rolling hash (the FNV prime as its base)
 * rather than FNV-1a because it composes: a run's hash is its first word's
 * hash times the next word's base power, plus the next word's hash. So each
 * character is read once, each run of words costs three multiplications, and
 * the sweep allocates nothing per word.
 *
 * A digest is not encryption. Anyone who already guesses a term can confirm
 * it, as with every digest here. What the design buys is the same thing as
 * above: the guard does not itself publish the list it enforces.
 *
 * To change the list, edit the private file and regenerate the digests from
 * it. The helper takes terms on argv and never reads a tracked file:
 *
 *   grep -v '^#' ~/.config/aglyn/public-text-denylist.txt | grep -v '^\s*$' |
 *     tr '\n' '\0' | xargs -0 node tools/scripts/check-personal-identifiers.mjs \
 *     --digest > tools/scripts/check-personal-identifiers.client-digests.json
 *
 * It refuses a term of more than three words, because the sweep never builds
 * a candidate that long.
 *
 * ## Commit messages and pull request text
 *
 * A commit message is as public as a file and, unlike a file, can never be
 * fixed. Two more modes read text that is not a tracked file, with the same
 * two classes:
 *
 *   --commits <range>   every message in `git log <range>`; CI runs it over a
 *                       pull request's own commits, and the pre-push hook over
 *                       the commits being pushed, which is the last point at
 *                       which a message can still be reworded.
 *   --stdin             text piped in, e.g. a pull request's title and body
 *                       or a comment (`.github/workflows/public-text-guard.yml`).
 *
 * Both print where (a line number, a commit) and which class, never the text.
 * A commit already on a protected branch cannot be reworded, because history
 * is never rewritten here; its full sha goes in the digests file's
 * `forgivenCommits`, which is the only way to let later ranges that contain it
 * pass. That list holds shas, never text.
 *
 * ## What it deliberately does not do
 *
 *  - **It does not forbid the owner's name.** The account owner's name is in
 *    the author field of every commit and in `CODEOWNERS`; sweeping it from
 *    display-name fixtures would touch a dozen files and remove nothing that
 *    is not already published irreducibly. A client's name is a different
 *    matter: nothing publishes it but us.
 *  - **It does not forbid the GitHub handle.** `@zgover` in `CODEOWNERS` is
 *    load-bearing, and `zgover.aglyn.com` is a real workspace host that CORS
 *    reconciliation is tested against. Only the HOME-DIRECTORY form is a
 *    finding, because that one names a machine layout and never a subject.
 *  - **It does not read history.** Only the working tree at HEAD, and the
 *    messages of the range it is handed. A value already committed stays
 *    reachable in the object store whatever this reports, and rewriting
 *    history is the repository owner's decision.
 *
 * ## Forcing it red
 *
 *   node tools/scripts/check-personal-identifiers.mjs --selftest
 *
 * asserts both comparators end to end against synthetic values and invented
 * terms, so the proof that the mechanism bites does not require the
 * mechanism's real inputs.
 *
 * Exit codes: 0 clean · 1 an identifier is present · 2 a usage or setup error.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inScope, scopeFromArgv, scopeNote } from './lib/guard-scope.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The values that must never return, as digests.
 *
 * `label` is what a failure prints, and it never prints the matched value: CI
 * logs are public artifacts on a public repo, so a guard that echoes what it
 * found to prove it found it has published it again.
 *
 * `fix` is the substitution that keeps the sentence's meaning. It is here
 * because the failure everybody reaches for first — delete the sentence — is
 * worse than the leak: these strings sit inside comments explaining real,
 * subtle bugs, and the property is what mattered, never the identity.
 */
const FORBIDDEN = [
  {
    label: "the account owner's work mailbox",
    sha256: 'a57504720403b4a1dc084dc6a5b46e880e32a03454a067d83d52a218fe713364',
    fix: 'Name the property: "an SSO account in the `aglyn-org-y5v14` tenant", '
      + '"the account owner\'s mailbox", "a single human recipient". In a '
      + 'fixture keep the aglyn.com domain but use a ROLE local-part where the '
      + 'domain is what the test is about (SSO governance, staff detection), '
      + 'and an example.com address where it is not.',
  },
  {
    label: "a second address on the account owner's work domain",
    sha256: '7989174c8c9cf375729e49967d9c09d144aa84760079d5c38ccf97deef85eaf9',
    fix: 'Describe what made it matter — "an identity on a consumer provider" '
      + '— rather than which identity it was.',
  },
  {
    label: "the account owner's personal consumer account",
    sha256: 'c7dbe178b03826ca93740b4de355405cc14d3711bb05f686115b4a3066c9e7ef',
    fix: 'This one is the permanent break-glass `super` identity. Naming it '
      + 'publishes the single account that sits outside Workspace MFA, '
      + 'offboarding and session revocation. Say "a consumer Google account '
      + 'outside the Workspace domain"; which account it is belongs in the '
      + 'password manager.',
  },
  {
    label: 'a third consumer account belonging to the same person',
    sha256: 'bbda5fc29f9d1d441d65404a5083aecf7f93c74938cd8c79fd2b1d63277bb1f3',
    fix: 'Refer to it by its role in the story — "a third consumer account" — '
      + 'not by address.',
  },
  {
    label: "a production Firebase uid belonging to a real person",
    sha256: '5454408a5eaaf7a3ec6433b7b47d3035ceddc2beb306986565697c9b501af724',
    fix: 'A uid is a stronger identifier than an address, and no observation '
      + 'here needs the value: "a tenant uid is not in the project pool" is '
      + 'the point. In a fixture use a synthetic 28-character uid.',
  },
  {
    label: "a developer's home directory path (macOS)",
    sha256: 'd77b0ea442b3ebfbd4ec64ada95dd9a08c78bf8407b9129e8934a7e20c930c95',
    fix: 'A workstation path is not a repository constant. Read it from an '
      + 'environment variable and skip the work when it is unset — '
      + '`AGLYN_DRIVE_MOUNT` and `tools/scripts/lib/drive-mount.mjs` are the '
      + 'worked example.',
  },
  {
    label: "a developer's home directory path (Linux)",
    sha256: '45f44baa083f2177bbed2fe97ac4dea1427504beaafe0616b11a74ddf9d47470',
    fix: 'Same as above — an environment variable, and a documented skip when '
      + 'it is absent.',
  },
]

/**
 * Candidate shapes. Deliberately broad — the digest is the real filter, and a
 * shape too narrow to match a reintroduction is the only way this guard can
 * silently pass.
 *
 * `lower` marks a shape whose candidates are compared case-insensitively.
 * Addresses are: `ZACH@AGLYN.COM` is the same mailbox and appeared that way in
 * a spec. Uids and paths are case-SENSITIVE and must not be folded, or a
 * lowercased uid would stop matching its own digest.
 */
const SHAPES = [
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, lower: true },
  { re: /\b[A-Za-z0-9_-]{28}\b/g, lower: false },
  { re: /\/(?:Users|home)\/[A-Za-z0-9._-]+/g, lower: false },
]

/**
 * Paths this guard does not read, each with the reason it would be wrong to.
 *
 * Short on purpose. An exemption is a hole, and the reason has to be that the
 * file's PURPOSE is to carry the value, not that removing it is inconvenient.
 */
const EXEMPT_PATH = [
  {
    re: /^tools\/scripts\/check-personal-identifiers\.mjs$/,
    why: 'this file — it names the digests',
  },
  {
    re: /^\.mailmap$/,
    why: '.mailmap exists to MAP the historical author addresses onto a '
      + 'noreply address, so `git log` stops showing them. Deleting the '
      + 'mapping does not remove those addresses from the commits that carry '
      + 'them — it puts them back in everybody\'s log output.',
  },
]


const digest = (value) => createHash('sha256').update(value).digest('hex')

/* ------------------------------------------------------------ client terms */

/** Where the client-identifier digests live. Digests only; never a term. */
const CLIENT_DIGESTS_PATH = join(
  REPO_ROOT,
  'tools',
  'scripts',
  'check-personal-identifiers.client-digests.json',
)

/** The longest candidate the sweep builds, in words. */
export const MAX_TERM_WORDS = 3

/** What a client-identifier finding prints. Never the matched text. */
export const CLIENT_CLASS = {
  label: 'a client identifier on the private list (a business, person, workspace, site host, phone number or id)',
  fix: 'Use an invented fixture — Acme Builders, Northwind Coffee, Jordan Lee, '
    + 'an example.com address, an invented 10-character id — keeping the shape '
    + 'the test needs. In prose, name the property: "a client site", "an '
    + 'image-heavy client page". A real client page that a tool must read '
    + 'belongs in a repository or environment variable, never in source.',
}

/** Odd, so multiplying by it is a bijection mod 2^32. The FNV prime. */
const ROLL_BASE = 0x01000193
const SPACE = 0x20

/**
 * The prefilter: a polynomial hash mod 2^32 over UTF-16 code units, starting
 * at zero, so `roll32(a + b) === roll32(a) * BASE ** b.length + roll32(b)`.
 */
export function roll32(text) {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(hash, ROLL_BASE) + text.charCodeAt(i)) >>> 0
  }
  return hash
}

/** A term's words: lower case, split on everything not a letter or digit. */
export function termWords(term) {
  return String(term).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * The digest entries for one term: its words joined by a space and joined by
 * nothing (one entry when the two agree, as for a single word).
 */
export function clientEntries(term) {
  const words = termWords(term)
  if (!words.length) throw new Error('an empty term has no digest')
  if (words.length > MAX_TERM_WORDS) {
    throw new Error(
      `a term of ${words.length} words is longer than the ${MAX_TERM_WORDS} the sweep builds; split it`,
    )
  }
  const forms = [...new Set([words.join(' '), words.join('')])]
  return forms.map((form) => ({
    roll32: roll32(form).toString(16).padStart(8, '0'),
    sha256: digest(form),
  }))
}

/**
 * The digests document for a list of terms, sorted by digest so its order says
 * nothing about the list's order or grouping.
 */
export function clientDigestsDocument(terms, forgivenCommits = []) {
  const bySha = new Map()
  for (const term of terms) {
    for (const entry of clientEntries(term)) bySha.set(entry.sha256, entry)
  }
  return {
    $comment:
      'Digests of the client identifiers on a private list kept off this '
      + 'repository. Regenerate with `--digest` (see the header of '
      + 'check-personal-identifiers.mjs). forgivenCommits: full shas of '
      + 'published commits whose message cannot be reworded.',
    digests: [...bySha.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
    forgivenCommits: [...forgivenCommits].sort(),
  }
}

/**
 * The prefilter and digest sets from a digests document. Throws on anything
 * malformed, and on an EMPTY list: a guard with nothing to compare against
 * passes everything, which is the one failure it must never have quietly.
 */
export function readClientDigests(document) {
  const entries = document?.digests
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('the client digest list is missing or empty')
  }
  const prefilter = new Set()
  const sha256 = new Set()
  for (const entry of entries) {
    if (!/^[0-9a-f]{8}$/.test(entry?.roll32 ?? '') || !/^[0-9a-f]{64}$/.test(entry?.sha256 ?? '')) {
      throw new Error('a client digest entry is not { roll32: 8 hex, sha256: 64 hex }')
    }
    prefilter.add(Number.parseInt(entry.roll32, 16))
    sha256.add(entry.sha256)
  }
  const forgiven = document.forgivenCommits ?? []
  if (!Array.isArray(forgiven) || forgiven.some((sha) => !/^[0-9a-f]{40}$/.test(sha))) {
    throw new Error('forgivenCommits must be a list of full 40-character shas')
  }
  // The prefilter's first stage: one byte per low-16-bit bucket, so almost
  // every candidate is rejected by an array read instead of a Set lookup.
  const buckets = new Uint8Array(1 << 16)
  for (const hash of prefilter) buckets[hash & 0xffff] = 1
  return { prefilter, buckets, sha256, forgivenCommits: new Set(forgiven) }
}

function loadClientDigests() {
  if (!existsSync(CLIENT_DIGESTS_PATH)) {
    throw new Error(`${CLIENT_DIGESTS_PATH} is missing`)
  }
  return readClientDigests(JSON.parse(readFileSync(CLIENT_DIGESTS_PATH, 'utf8')))
}

/**
 * Offsets of every one-to-three-word run in `text` that matches a client
 * digest, joined by a space or by nothing.
 *
 * One pass, one word at a time, keeping only the two words before it: each
 * word's hash and base power are built as its characters are read (ASCII
 * letters folded to lower case on the way), and the runs that END at this
 * word are composed from them. Nothing is sliced, lower-cased or hashed with
 * SHA-256 unless the prefilter matches.
 */
export function findClientIdentifiers(text, clients) {
  const { prefilter, buckets, sha256 } = clients
  const found = []
  const length = text.length
  // The current word and the two before it: start, end, hash, base power
  // (the current word's only) and whether it is all digits. A start of -1 is
  // a word that has not been read yet.
  let s0 = -1, e0 = 0, h0 = 0, p0, d0 = false
  let s1 = -1, e1 = 0, h1, d1 = false
  let s2, e2, d2
  // The runs of two that ended at the previous word, spaced and joined.
  let spacedPair = 0
  let joinedPair = 0

  const passes = (hash) => buckets[hash & 0xffff] === 1 && prefilter.has(hash)
  const confirmed = (candidate) => sha256.has(digest(candidate))
  const wordAt = (start, end) => text.slice(start, end).toLowerCase()
  const hit = (start) => {
    if (found[found.length - 1] !== start) found.push(start)
  }
  // A long number: also its last ten and last seven digits (country code,
  // area code). Rare, so it is built as a string and hashed directly.
  const digitsTail = (start, number) => {
    for (const tail of [10, 7]) {
      if (number.length <= tail) continue
      const suffix = number.slice(-tail)
      if (passes(roll32(suffix)) && confirmed(suffix)) hit(start)
    }
  }

  for (let i = 0; i < length; ) {
    let code = text.charCodeAt(i)
    if (code >= 0x41 && code <= 0x5a) code += 0x20
    if (!((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39))) {
      i++
      continue
    }
    // Read one word.
    const start = i
    let hash = 0
    let power = 1
    let digits = true
    for (; i < length; i++) {
      code = text.charCodeAt(i)
      if (code >= 0x41 && code <= 0x5a) code += 0x20
      if (code >= 0x61 && code <= 0x7a) digits = false
      else if (!(code >= 0x30 && code <= 0x39)) break
      hash = (Math.imul(hash, ROLL_BASE) + code) >>> 0
      power = Math.imul(power, ROLL_BASE)
    }
    // Shift the window: the word before becomes two before, and so on.
    s2 = s1; e2 = e1; d2 = d1
    s1 = s0; e1 = e0; h1 = h0; d1 = d0
    s0 = start; e0 = i; h0 = hash; p0 = power; d0 = digits
    const previousSpacedPair = spacedPair
    const previousJoinedPair = joinedPair

    // One word.
    if (passes(h0) && confirmed(wordAt(s0, e0))) hit(s0)
    if (d0 && e0 - s0 >= 8) digitsTail(s0, text.slice(s0, e0))
    if (s1 < 0) continue

    // Two words ending here.
    joinedPair = (Math.imul(h1, p0) + h0) >>> 0
    spacedPair = (Math.imul((Math.imul(h1, ROLL_BASE) + SPACE) >>> 0, p0) + h0) >>> 0
    if (passes(spacedPair) && confirmed(`${wordAt(s1, e1)} ${wordAt(s0, e0)}`)) hit(s1)
    if (passes(joinedPair) && confirmed(wordAt(s1, e1) + wordAt(s0, e0))) hit(s1)
    if (d1 && d0 && e1 - s1 + e0 - s0 >= 8) {
      digitsTail(s1, text.slice(s1, e1) + text.slice(s0, e0))
    }
    if (s2 < 0) continue

    // Three words ending here.
    const joinedThree = (Math.imul(previousJoinedPair, p0) + h0) >>> 0
    const spacedThree =
      (Math.imul((Math.imul(previousSpacedPair, ROLL_BASE) + SPACE) >>> 0, p0) + h0) >>> 0
    if (passes(spacedThree) && confirmed(`${wordAt(s2, e2)} ${wordAt(s1, e1)} ${wordAt(s0, e0)}`)) hit(s2)
    if (passes(joinedThree) && confirmed(wordAt(s2, e2) + wordAt(s1, e1) + wordAt(s0, e0))) hit(s2)
    if (d2 && d1 && d0 && e2 - s2 + e1 - s1 + e0 - s0 >= 8) {
      digitsTail(s2, text.slice(s2, e2) + text.slice(s1, e1) + text.slice(s0, e0))
    }
  }
  return found
}

/* ---------------------------------------------------------------- scanning */

/** 1-based line numbers of ascending offsets into `text`. */
function linesOf(text, offsets) {
  const sorted = [...offsets].sort((a, b) => a - b)
  const lines = new Map()
  let line = 1
  let at = 0
  for (const offset of sorted) {
    for (; at < offset && at < text.length; at++) if (text.charCodeAt(at) === 10) line++
    lines.set(offset, line)
  }
  return lines
}

/**
 * Every finding in `text`, as `{ entry, line }`, one per class and line.
 *
 * `forbidden` and `clients` are parameters so the self-test can drive both
 * comparators with synthetic lists, which is what lets this guard prove it
 * bites without ever containing the values it forbids.
 */
export function scanText(text, { forbidden = FORBIDDEN, clients } = {}) {
  const byHash = new Map(forbidden.map((entry) => [entry.sha256, entry]))
  const raw = []
  for (const { re, lower } of SHAPES) {
    for (const match of text.matchAll(re)) {
      const hit = byHash.get(digest(lower ? match[0].toLowerCase() : match[0]))
      if (hit) raw.push({ entry: hit, offset: match.index })
    }
  }
  const shapeLines = linesOf(text, raw.map((one) => one.offset))
  const findings = raw.map(({ entry, offset }) => ({ entry, line: shapeLines.get(offset) }))
  if (clients) {
    const offsets = findClientIdentifiers(text, clients)
    const clientLines = linesOf(text, offsets)
    for (const offset of offsets) findings.push({ entry: CLIENT_CLASS, line: clientLines.get(offset) })
  }
  const seen = new Set()
  return findings
    .filter(({ entry, line }) => {
      const key = `${entry.label}\0${line}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.line - b.line)
}

/** Tracked, non-binary files. `git ls-files`, never a filesystem walk: the
 * concern is what is PUBLISHED, so an untracked scratch file or a gitignored
 * `.env` holding a real value is correct, not a violation. */
function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
}

/** The remediation, once per class that was found. */
function printFixes(findings) {
  const classes = new Map(findings.map(({ entry }) => [entry.label, entry]))
  for (const entry of classes.values()) {
    console.error(`  ${entry.label}\n    → ${entry.fix}\n`)
  }
}

const PUBLIC_WARNING = [
  'This repository is PUBLIC, and a commit is permanent: git history does',
  'not forget, so a reintroduction cannot be taken back by a later edit.',
  '',
  'These comments and fixtures are load-bearing — they explain real bugs.',
  'Do NOT delete the explanation to remove the name. Name the PROPERTY that',
  'mattered instead; it is what the sentence meant, and it reads better.',
  '',
].join('\n')

function sweepFiles(argv, clients) {
  let scope
  try {
    scope = scopeFromArgv(argv)
  } catch (error) {
    console.error(error.message)
    return 2
  }
  const files = trackedFiles().filter((file) => inScope(scope, file))
  const violations = []
  let scanned = 0
  for (const file of files) {
    if (EXEMPT_PATH.some(({ re }) => re.test(file))) continue
    let text
    try {
      text = readFileSync(join(REPO_ROOT, file), 'utf8')
    } catch {
      continue // unreadable or binary — no string literal to leak
    }
    if (text.includes('\0')) continue
    scanned += 1
    for (const finding of scanText(text, { clients })) violations.push({ file, ...finding })
  }

  if (!violations.length) {
    console.log(
      `check-personal-identifiers: OK — no personal or client identifier in ${scanned} tracked files.` +
        (scope ? ` ${scopeNote(scope)}.` : ''),
    )
    return 0
  }

  console.error('check-personal-identifiers: PERSONAL OR CLIENT IDENTIFIER IN TRACKED SOURCE\n')
  for (const { file, line, entry } of violations) console.error(`  ${file}:${line}  ${entry.label}`)
  console.error('')
  printFixes(violations)
  console.error(PUBLIC_WARNING)
  return 1
}

function sweepStdin(argv, clients) {
  const at = argv.indexOf('--label')
  const label = at >= 0 && argv[at + 1] ? argv[at + 1] : 'stdin'
  const text = readFileSync(0, 'utf8')
  const findings = scanText(text, { clients })
  if (!findings.length) {
    console.log(`check-personal-identifiers: OK — no personal or client identifier in ${label}.`)
    return 0
  }
  console.error(`check-personal-identifiers: PERSONAL OR CLIENT IDENTIFIER IN ${label}\n`)
  for (const { line, entry } of findings) console.error(`  ${label} line ${line}  ${entry.label}`)
  console.error('')
  printFixes(findings)
  console.error(
    'This text is public. Edit it to name the property instead ("a client site"), '
      + 'then ask the repository owner to delete the earlier revision, which '
      + 'GitHub keeps in the edit history.',
  )
  return 1
}

/** `git log <range>` as `[{ sha, message }]`. */
export function commitMessages(range, run = (args) => execFileSync('git', args, {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
})) {
  return run(['log', '--format=%H%x1f%B%x1e', range])
    .split('\x1e')
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.includes('\x1f'))
    .map((record) => {
      const [sha, message] = record.split('\x1f')
      return { sha: sha.trim(), message }
    })
}

function sweepCommits(argv, clients) {
  const range = argv[argv.indexOf('--commits') + 1]
  if (!range || range.startsWith('--')) {
    console.error('--commits needs a revision range, e.g. origin/main..HEAD')
    return 2
  }
  let commits
  try {
    commits = commitMessages(range)
  } catch (error) {
    console.error(`cannot read ${range}: ${String(error.message).split('\n')[0]}`)
    return 2
  }
  const violations = []
  let forgiven = 0
  for (const { sha, message } of commits) {
    if (clients.forgivenCommits.has(sha)) {
      forgiven += 1
      continue
    }
    for (const finding of scanText(message, { clients })) violations.push({ sha, ...finding })
  }
  const note = forgiven ? ` (${forgiven} forgiven, already published)` : ''
  if (!violations.length) {
    console.log(
      `check-personal-identifiers: OK — no personal or client identifier in ${commits.length} commit message(s)${note}.`,
    )
    return 0
  }
  console.error('check-personal-identifiers: PERSONAL OR CLIENT IDENTIFIER IN A COMMIT MESSAGE\n')
  for (const { sha, line, entry } of violations) {
    console.error(`  commit ${sha.slice(0, 12)} line ${line}  ${entry.label}`)
  }
  console.error('')
  printFixes(violations)
  console.error(
    [
      'Before it is pushed, reword the message (`git commit --amend` on the tip,',
      'an interactive rebase below it). Once it is on a shared branch it cannot',
      'be reworded, because history is never rewritten here: add its full sha to',
      'forgivenCommits in check-personal-identifiers.client-digests.json, and say',
      'so to the repository owner.',
      '',
    ].join('\n'),
  )
  return 1
}

/* ---------------------------------------------------------------- selftest */

function selftest() {
  const failures = []
  const expect = (label, condition) => {
    if (!condition) failures.push(label)
  }

  // The shapes: drives the comparator end to end against a value this file
  // may safely contain, proving shape-match → digest → report without the
  // real inputs.
  const CANARY = 'canary@selftest.example'
  const synthetic = [{ label: 'a synthetic canary', sha256: digest(CANARY), fix: 'n/a' }]
  const shape = (text, forbidden = synthetic) => scanText(text, { forbidden })
  const hit = shape(`const a = 1\nconst owner = '${CANARY}'\n`)
  expect('the guard did NOT flag a reintroduction', hit.length === 1 && hit[0].entry.label === 'a synthetic canary')
  expect('a finding names the wrong line', hit[0]?.line === 2)
  expect('the guard flagged an unrelated address', shape("const owner = 'someone@example.com'\n").length === 0)
  // Case folding is part of the contract for the address shape.
  expect('an uppercased address slipped past', shape(CANARY.toUpperCase()).length === 1)
  // Anti-vacuity: the uid and path shapes must really match something, or a
  // regex that silently stopped matching would make this guard pass forever.
  const uid = [{ label: 'uid', sha256: digest('AbcdefghijklmnopqrstuvwxyZ12'), fix: 'n/a' }]
  expect('the uid shape matches nothing', shape("uid: 'AbcdefghijklmnopqrstuvwxyZ12'", uid).length === 1)
  const home = [{ label: 'home', sha256: digest('/Users/someone'), fix: 'n/a' }]
  expect('the home-path shape matches nothing', shape("const p = '/Users/someone/Library'", home).length === 1)

  // The client class, against digests of INVENTED terms only.
  const invented = readClientDigests(
    clientDigestsDocument(['Acme Builders', 'Jordan Lee', 'Northwind', 'Zx7Qp4Lm2-', '555-010-0199', '010-0177']),
  )
  const client = (text) => scanText(text, { forbidden: [], clients: invented })
  const flags = (label, text, line = 1) => {
    const found = client(text)
    expect(`${label}: not flagged`, found.length >= 1 && found[0].entry === CLIENT_CLASS)
    expect(`${label}: wrong line`, found[0]?.line === line)
  }
  flags('a business name in prose', 'Built for Acme Builders and their crew.')
  flags('a name across a line break', 'one\nmade by ACME\nbuilders', 2)
  flags('a slug', "slug: 'acme-builders'")
  flags('a host', 'https://acme-builders.aglyn-test.example/services')
  flags('a camelCase identifier', 'function acmeBuilders() {}')
  flags('a SCREAMING_SNAKE constant', 'const ACME_BUILDERS_PAGES = 6')
  flags('a slug joined with nothing', 'cname--acmebuilders.example')
  flags('a person', "name: 'Jordan Lee'")
  flags('an email local part', 'jordan.lee@example.com')
  flags('a single-word term', 'Northwind roasts on Tuesdays')
  flags('an id with a trailing dash', "media:org:Zx7Qp4Lm2-/logo")
  flags('a phone number', 'Call (555) 010-0199')
  flags('a phone number with a country code', 'sms:+15550100199')
  flags('a 7-digit local number inside a full one', 'tel:2100100177')
  expect('a near miss was flagged', client('Acme Build and Jordan Leeds').length === 0)
  expect('a word inside a longer word was flagged', client('the northwinds blew').length === 0)
  expect('an unrelated number was flagged', client('total 5550100198 and 555-010-0198').length === 0)
  expect('one name was reported twice on one line', client('Acme Builders, acme-builders').length === 1)

  // The prefilter must agree with its digest: a prefilter that disagreed would
  // filter every candidate out before hashing and pass forever.
  const entry = clientEntries('Acme Builders')
  expect('a term yields its spaced and joined forms', entry.length === 2)
  expect('the prefilter disagrees with the digest', entry[0].roll32 === roll32('acme builders').toString(16).padStart(8, '0'))
  // The sweep composes runs from words; that only works if the hash does.
  let power = 1
  for (let i = 0; i < 'builders'.length; i++) power = Math.imul(power, ROLL_BASE)
  expect(
    'the rolling hash does not compose',
    roll32('acme builders') === (Math.imul(roll32('acme '), power) + roll32('builders')) >>> 0,
  )
  let refused = false
  try {
    clientEntries('one two three four')
  } catch {
    refused = true
  }
  expect('a four-word term was accepted', refused)
  refused = false
  try {
    readClientDigests({ digests: [] })
  } catch {
    refused = true
  }
  expect('an empty digest list was accepted', refused)

  // The real list must load and be non-empty, or the sweep is vacuous.
  let real
  try {
    real = loadClientDigests()
  } catch (error) {
    failures.push(`the client digest list does not load: ${error.message}`)
  }
  expect('the client digest list is empty', (real?.sha256.size ?? 0) > 0)

  // The commit reader splits a log into messages.
  const log = 'a'.repeat(40) + '\x1fsubject one\n\nbody\n\x1e\n' + 'b'.repeat(40) + '\x1fsubject two\n\x1e'
  const commits = commitMessages('x..y', () => log)
  expect('the commit reader lost a commit', commits.length === 2 && commits[1].sha === 'b'.repeat(40))
  expect('the commit reader lost a body', commits[0]?.message.includes('body'))

  if (failures.length) {
    for (const failure of failures) console.error(`selftest: FAILED — ${failure}`)
    return 1
  }
  console.log(
    'selftest: OK — flags a synthetic reintroduction in all three shapes and invented client terms in every '
      + 'written form, ignores near misses, and the real digest list loads.',
  )
  return 0
}

/* -------------------------------------------------------------------- main */

function main(argv) {
  if (argv.includes('--selftest')) return selftest()
  if (argv.includes('--digest')) {
    const terms = argv.filter((arg) => arg !== '--digest')
    if (!terms.length) {
      console.error('--digest needs one or more terms on argv, never a tracked file')
      return 2
    }
    try {
      process.stdout.write(`${JSON.stringify(clientDigestsDocument(terms), null, 2)}\n`)
    } catch (error) {
      console.error(error.message)
      return 2
    }
    return 0
  }
  let clients
  try {
    clients = loadClientDigests()
  } catch (error) {
    console.error(`check-personal-identifiers: ${error.message}`)
    return 2
  }
  if (argv.includes('--stdin')) return sweepStdin(argv, clients)
  if (argv.includes('--commits')) return sweepCommits(argv, clients)
  return sweepFiles(argv, clients)
}

process.exit(main(process.argv.slice(2)))
