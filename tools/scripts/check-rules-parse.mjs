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
 * DOES THE SECURITY RULES FILE ACTUALLY PARSE? (AGL-1621)
 * =======================================================
 *
 * On 2026-08-23 a scripted edit to `cloud/firebase-firestore.rules` dropped a
 * closing paren from two `hasAny(…)` expressions. The full suite stayed
 * GREEN. It was caught by a human reading the diff.
 *
 * Nothing was wrong with the suite; it was answering a different question.
 * The three deny-coverage guards
 * (`libs/aglyn/src/lib/foundation/definitions/*-deny-coverage.spec.ts`) read
 * the rules as TEXT and assert about FIELD NAMES — `hasAnyKeys()` is
 * `/hasAny\(\s*\[([^\]]*)\]/g`, which reads what sits between `[` and `]` and
 * cannot care what follows the `]`. The block walkers count BRACES, never
 * parens. So every one of the 47 assertions passed against a file the
 * Firestore compiler rejects at `L299:37 Unexpected ';'`. Measured, not
 * assumed — see the fail-on-purpose fixtures in `--self-test`.
 *
 * The rest of CI could not have covered it either. `npm run test:rules` does
 * compile the file (the rules-unit-testing harness uploads it), but
 * `emulator-guards.yml` moved its push trigger from `main` to `production` in
 * the Sept-1 freeze, and `rules-drift.yml` is `production`-only for the same
 * reason. A file that does not parse could sit on `main` until a promotion.
 *
 * This guard exists to answer the one question none of those answer on every
 * commit: does this file parse.
 *
 * TWO TIERS, AND AN EXPLICIT STATEMENT OF WHICH ONE RAN
 * ----------------------------------------------------
 * A guard that quietly degrades to checking nothing is worse than no guard,
 * so this one always names its coverage rather than printing a bare green.
 *
 *  1. BALANCE — offline, dependency-free, sub-millisecond, runs EVERYWHERE.
 *     A single left-to-right scan that is comment- and string-aware, tracking
 *     `(`/`[`/`{` depth. An unbalanced delimiter is reported with the line
 *     and column of the opener that never closed, or of the closer that had
 *     no opener. This is the tier that catches the dropped paren, and it is
 *     the tier that runs in the derived guard sweep on every commit.
 *
 *  2. COMPILE — the real Firestore Rules compiler, via the emulator's
 *     `PUT /emulator/v1/projects/{p}:securityRules` endpoint. That endpoint
 *     compiles and REJECTS with the compiler's own `L<line>:<col> <message>`;
 *     it needs no credentials, contacts no Google service and deploys
 *     nothing. Used automatically against an emulator that is already up
 *     (`FIRESTORE_EMULATOR_HOST`), and otherwise a throwaway one is booted —
 *     but only when `firebase` and `java` are both already on PATH, because
 *     a guard must never pull a toolchain down from the network mid-run.
 *
 * Note what tier 2 is NOT: `firebase emulators:exec --only firestore` on its
 * own is not a compile check. Measured on the broken file above, the emulator
 * started clean and the script exited 0 — it does not load the rules until a
 * project asks it to. The upload endpoint is the compile.
 *
 * EXIT CODES, and the third one on purpose: a skipped check that reports
 * success is the failure shape this repo has been bitten by before.
 *
 *   0 — every tier that ran passed, and tier 1 always runs.
 *   1 — a rules file is broken. The file is NAMED, with line and column.
 *   2 — could not check at all (a rules file is missing/unreadable).
 *
 * Usage:
 *   node tools/scripts/check-rules-parse.mjs [--no-boot] [--self-test] [file…]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** The rules files this repo ships. Both are compiled by the same grammar. */
const DEFAULT_TARGETS = [
  'cloud/firebase-firestore.rules',
  'cloud/firebase-storage.rules',
]

/*===========================================================================
 * TIER 1 — the offline structural scan.
 *==========================================================================*/

const OPENERS = { '(': ')', '[': ']', '{': '}' }
const CLOSERS = { ')': '(', ']': '[', '}': '{' }

/**
 * Every delimiter imbalance in `source`, as `{ line, column, message }`.
 *
 * ONE left-to-right scan, which is the only way to get this right: comments
 * and string literals hide delimiters from each other in both directions.
 * A two-pass "strip comments, then strip strings" is what produced AGL-2004,
 * where a `/*`-looking fragment inside a line comment opened a phantom block
 * comment and swallowed 571 lines of rules — and the guard reading the
 * remains still went green.
 *
 * Deliberately NOT a grammar. It answers "are the delimiters balanced", which
 * is the class of break a scripted edit produces, and it answers it with no
 * dependency, no JVM and no network. Tier 2 is the grammar.
 */
export function delimiterFaults(source) {
  const faults = []
  const stack = []
  let line = 1
  let column = 1
  let i = 0
  const at = () => ({ line, column })
  const advance = (n) => {
    for (let k = 0; k < n && i + k < source.length; k += 1) {
      if (source[i + k] === '\n') {
        line += 1
        column = 1
      } else {
        column += 1
      }
    }
    i += n
  }
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      advance(end < 0 ? source.length - i : end + 2 - i)
      continue
    }
    if (two === '//') {
      const end = source.indexOf('\n', i + 2)
      advance(end < 0 ? source.length - i : end - i)
      continue
    }
    const ch = source[i]
    if (ch === "'" || ch === '"') {
      // Rules string literals do not span lines. An unterminated one is
      // itself a break, and is reported as such rather than swallowing the
      // remainder of the file the way a naive scan would.
      let k = i + 1
      while (k < source.length && source[k] !== ch && source[k] !== '\n') {
        k += source[k] === '\\' ? 2 : 1
      }
      if (k >= source.length || source[k] === '\n') {
        faults.push({ ...at(), message: `unterminated ${ch === "'" ? 'single' : 'double'}-quoted string` })
        advance(1)
        continue
      }
      advance(k + 1 - i)
      continue
    }
    if (OPENERS[ch]) {
      stack.push({ ch, ...at() })
      advance(1)
      continue
    }
    if (CLOSERS[ch]) {
      const top = stack[stack.length - 1]
      if (!top) {
        faults.push({ ...at(), message: `stray closing \`${ch}\` — nothing is open here` })
      } else if (top.ch !== CLOSERS[ch]) {
        faults.push({
          ...at(),
          message:
            `\`${ch}\` closes the \`${top.ch}\` opened at line ${top.line}:${top.column} ` +
            `— expected \`${OPENERS[top.ch]}\``,
        })
        stack.pop()
      } else {
        stack.pop()
      }
      advance(1)
      continue
    }
    advance(1)
  }
  for (const open of stack) {
    faults.push({
      line: open.line,
      column: open.column,
      message: `\`${open.ch}\` opened here is never closed`,
    })
  }
  return faults
}

/*===========================================================================
 * TIER 2 — the real compiler, through the emulator's upload endpoint.
 *==========================================================================*/

const PROJECT = 'demo-rules-parse'

/** POST the source to a running emulator; null = compiled, string = the error. */
async function compileAgainst(hostPort, source) {
  const url = `http://${hostPort}/emulator/v1/projects/${PROJECT}:securityRules`
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rules: { files: [{ name: 'rules', content: source }] },
    }),
  })
  if (response.ok) return null
  const body = await response.json().catch(() => null)
  return String(body?.error?.message ?? `HTTP ${response.status}`)
}

/** `true` when the binary answers `--version` without going to the network. */
function onPath(binary, args) {
  const probe = spawnSync(binary, args, { stdio: 'ignore', timeout: 30_000 })
  return probe.status === 0
}

/**
 * Whether a throwaway emulator can be booted here. Both must ALREADY be
 * installed: a guard that npm-installs a CLI or downloads a JDK mid-run turns
 * a 50ms check into a multi-minute one and fails on an offline machine.
 */
function canBoot() {
  return onPath('firebase', ['--version']) && onPath('java', ['-version'])
}

/**
 * Boot a Firestore emulator on an unused port and compile each source against
 * it. Returns a map of `label -> error|null`.
 *
 * The ports are deliberately not the ones in `cloud/firebase.json`: a
 * developer (or a concurrent agent) with the real emulator suite up must not
 * have this guard fail on "port taken", and must not have their emulator's
 * rules replaced by this guard's upload.
 */
function bootAndCompile(sources) {
  const dir = mkdtempSync(join(tmpdir(), 'aglyn-rules-parse-'))
  try {
    const port = 18400 + Math.floor(Math.random() * 300)
    writeFileSync(
      join(dir, 'firebase.json'),
      JSON.stringify({
        firestore: { rules: 'noop.rules' },
        emulators: {
          firestore: { port },
          hub: { port: port + 1 },
          logging: { port: port + 2 },
          ui: { enabled: false },
        },
      }),
    )
    // The emulator needs A rules file to start; it is never the one under
    // test. Every file under test arrives through the upload endpoint, which
    // is the compile.
    writeFileSync(
      join(dir, 'noop.rules'),
      "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{db}/documents {\n    match /{d=**} { allow read, write: if false; }\n  }\n}\n",
    )
    writeFileSync(
      join(dir, 'probe.mjs'),
      `const sources = JSON.parse(process.env.RULES_PARSE_SOURCES)
const out = {}
for (const [label, content] of Object.entries(sources)) {
  const res = await fetch(
    'http://127.0.0.1:${port}/emulator/v1/projects/${PROJECT}:securityRules',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'rules', content }] } }),
    },
  )
  if (res.ok) { out[label] = null; continue }
  const body = await res.json().catch(() => null)
  out[label] = String(body?.error?.message ?? ('HTTP ' + res.status))
}
process.stdout.write('\\nRULES_PARSE_BEGIN' + JSON.stringify(out) + 'RULES_PARSE_END\\n')
`,
    )
    // The firebase-tools standalone binary shadows \`node\` inside the exec
    // shell with its own bundled runtime — the same trap documented in
    // tools/scripts/test-rules.sh. Resolve the real one first.
    const nodeBin = execFileSync('command', ['-v', 'node'], { shell: true, encoding: 'utf8' }).trim()
    const out = execFileSync(
      'firebase',
      [
        'emulators:exec',
        '--config', join(dir, 'firebase.json'),
        '--only', 'firestore',
        '--project', PROJECT,
        `'${nodeBin}' ${join(dir, 'probe.mjs')}`,
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        timeout: 240_000,
        env: { ...process.env, RULES_PARSE_SOURCES: JSON.stringify(sources) },
      },
    )
    // Bounded by BOTH markers. The emulator interleaves its own progress
    // lines on the same stream, so a line-based extraction picks up trailing
    // text and dies on a JSON parse error that looks like a guard bug.
    const from = out.indexOf('RULES_PARSE_BEGIN')
    const to = out.indexOf('RULES_PARSE_END')
    if (from < 0 || to < from) throw new Error('the emulator probe produced no result')
    return JSON.parse(out.slice(from + 'RULES_PARSE_BEGIN'.length, to))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/*===========================================================================
 * SELF-TEST — the guard's own fail-on-purpose, kept rather than performed
 * once. Every fixture is a break this guard claims to catch, plus the shapes
 * it must NOT fire on.
 *==========================================================================*/

const WELL_FORMED = `rules_version = '2';
// A line comment with an unbalanced ( paren and a /* fragment in it.
service cloud.firestore {
  match /databases/{database}/documents {
    /* A block comment with ) and ] and } in it. */
    match /orgs/{orgId} {
      allow update: if (isSuperStaff() &&
          !request.resource.data.diff(resource.data).affectedKeys().hasAny(
            ['slug', 'ownerUid', 'suspendedEnforcement'])) ||
        (isBillingStaff() &&
          !request.resource.data.diff(resource.data).affectedKeys().hasAny(
            ['slug', 'erasureRequestedAt']));
      allow read: if request.auth.uid != null && "a ) string ] with } delimiters" != '';
    }
  }
}
`

function selfTest() {
  let failures = 0
  const ok = (label, condition) => {
    console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}`)
    if (!condition) failures += 1
  }

  ok('a well-formed file has no faults', delimiterFaults(WELL_FORMED).length === 0)

  // THE EXACT MUTATION THAT FOOLED THE SUITE. One closing paren removed from
  // a `hasAny(…)` expression — twice, as it happened on 2026-08-23.
  const dropped = WELL_FORMED
    .replace("'suspendedEnforcement'])) ||", "'suspendedEnforcement']) ||")
    .replace("['slug', 'erasureRequestedAt']));", "['slug', 'erasureRequestedAt']);")
  ok('the mutation really changed the source', dropped !== WELL_FORMED)
  const droppedFaults = delimiterFaults(dropped)
  ok('a dropped `hasAny(…)` paren is a fault', droppedFaults.length > 0)
  // Naming the statement is the whole value over "the file is broken
  // somewhere": the openers that never closed are the two `hasAny(…)`
  // expressions the edit touched, at lines 7 and 10 of the fixture.
  ok(
    'and it POINTS AT the `allow update` statement, not just at end of file',
    droppedFaults.some((f) => /opened at line (7|10):/.test(f.message)),
  )
  // The negative control for that: the same predicate must find nothing in a
  // file that parses, or it is matching noise.
  ok(
    'that pointer does not appear for a well-formed file',
    !delimiterFaults(WELL_FORMED).some((f) => /opened at line/.test(f.message)),
  )

  // The neighbouring breaks a scripted edit also produces.
  ok('a stray closing paren is a fault', delimiterFaults('a() )').length > 0)
  ok(
    'an unclosed brace is a fault',
    delimiterFaults('service x {\n match /a/{b} {\n}\n').length > 0,
  )
  ok(
    'a mismatched pair is a fault',
    delimiterFaults('hasAny([1, 2)').length > 0,
  )
  ok(
    'an unterminated string is a fault',
    delimiterFaults("allow read: if a == 'oops;\n").length > 0,
  )

  // ...and the shapes it must NOT fire on, or it would be unusable on the
  // real file. A guard that cries wolf gets deleted, and then nothing checks.
  ok(
    'delimiters inside a LINE comment are ignored',
    delimiterFaults('// ( [ { unbalanced\nservice x {}\n').length === 0,
  )
  ok(
    'delimiters inside a BLOCK comment are ignored',
    delimiterFaults('/* ( [ { */\nservice x {}\n').length === 0,
  )
  ok(
    'delimiters inside a STRING are ignored',
    delimiterFaults(`service x { allow read: if a == '([{'; }\n`).length === 0,
  )
  // AGL-2004's shape: a `/*` INSIDE a line comment must not open a block
  // comment and swallow the file. If it did, everything after would vanish
  // and the unclosed `service {` below would go unreported.
  ok(
    'a `/*` inside a line comment does not open a block comment',
    delimiterFaults('// see `hosts/{id}/*` for this\nservice x {\n').length === 1,
  )
  // ...and the negative control for that same case, so the assertion above
  // cannot pass because the scanner simply reports everything.
  ok(
    'the same source, balanced, is clean',
    delimiterFaults('// see `hosts/{id}/*` for this\nservice x {}\n').length === 0,
  )

  // THE DIVISION OF LABOUR, stated as a fixture rather than left implied.
  // This source is perfectly balanced and is not rules at all; tier 1 is
  // SUPPOSED to pass it, and tier 2 rejects it with
  // `L2:1 mismatched input 'this' expecting {'function','import','service'}`
  // (measured). Asserting tier 1's blind spot here is what stops anyone
  // reading a green from this guard as "the grammar is fine".
  ok(
    'a balanced file that is not rules at all passes tier 1 — tier 2 is what rejects it',
    delimiterFaults("rules_version = '2';\nthis is not rules at all\n").length === 0,
  )

  // Anti-vacuity on the target list: a typo'd path would make the real check
  // silently examine nothing.
  ok(
    'every default target exists',
    DEFAULT_TARGETS.every((t) => existsSync(join(root, t))),
  )
  ok('there is more than one default target', DEFAULT_TARGETS.length > 1)

  console.log(failures === 0 ? '\nrules-parse self-test: PASS' : `\nrules-parse self-test: ${failures} FAILED`)
  return failures === 0 ? 0 : 1
}

/*===========================================================================
 * MAIN
 *==========================================================================*/

async function main(argv) {
  if (argv.includes('--self-test')) return selfTest()

  const noBoot = argv.includes('--no-boot') || process.env.RULES_PARSE_NO_BOOT === '1'
  const targets = argv.filter((a) => !a.startsWith('--'))
  const files = (targets.length ? targets : DEFAULT_TARGETS).map((t) => {
    const path = resolve(root, t)
    const rel = relative(root, path)
    // A path outside the repo (a pinned worktree, a fixture) keeps the name
    // it was given rather than a wall of `../`.
    return { label: !rel || rel.startsWith('..') ? t : rel, path }
  })

  const sources = {}
  for (const file of files) {
    if (!existsSync(file.path)) {
      console.error(`check:rules-parse: CANNOT CHECK — ${file.label} does not exist.`)
      console.error('  Exiting 2 rather than 0: a check that examined nothing has not passed.')
      return 2
    }
    sources[file.label] = readFileSync(file.path, 'utf8')
  }

  let broken = 0

  // ---- tier 1, always.
  for (const [label, source] of Object.entries(sources)) {
    const faults = delimiterFaults(source)
    if (faults.length === 0) continue
    broken += 1
    console.error(`\n✖ ${label} — does not parse (${faults.length} structural fault${faults.length === 1 ? '' : 's'}):`)
    for (const fault of faults.slice(0, 10)) {
      console.error(`    L${fault.line}:${fault.column}  ${fault.message}`)
    }
    if (faults.length > 10) console.error(`    […${faults.length - 10} more]`)
  }

  // ---- tier 2, when a compiler is reachable. Skipped when tier 1 already
  // failed: the compiler would only restate a break we have already named,
  // and booting a JVM to do it wastes half a minute of a red run.
  let compiler = 'NOT REACHABLE — structural check only'
  if (broken > 0) {
    compiler = 'not attempted — already broken above'
  } else {
    const running = process.env.FIRESTORE_EMULATOR_HOST
    try {
      let results = null
      if (running) {
        results = {}
        for (const [label, source] of Object.entries(sources)) {
          results[label] = await compileAgainst(running, source)
        }
        compiler = `RAN against the emulator at ${running}`
      } else if (!noBoot && canBoot()) {
        results = bootAndCompile(sources)
        compiler = 'RAN against a throwaway Firestore emulator'
      }
      for (const [label, error] of Object.entries(results ?? {})) {
        if (!error) continue
        broken += 1
        console.error(`\n✖ ${label} — the Firestore Rules compiler rejected it:`)
        for (const line of String(error).split('\n')) console.error(`    ${line}`)
      }
    } catch (error) {
      // A compiler that could not be reached is NOT a pass and NOT a
      // failure — it is a tier that did not run, and the line below says so
      // in the output rather than leaving a bare green to be misread.
      compiler = `NOT REACHABLE — ${String(error?.message ?? error).split('\n')[0]}`
    }
  }

  console.log(
    `\ncheck:rules-parse — ${Object.keys(sources).length} file(s): ` +
      `${broken === 0 ? 'OK' : `${broken} BROKEN`}\n` +
      `  structural: RAN (delimiter balance, comment- and string-aware)\n` +
      `  compiler:   ${compiler}`,
  )
  if (compiler.startsWith('NOT REACHABLE')) {
    console.log(
      '  → the grammar was not checked here. `firebase` + `java` on PATH, or a\n' +
        '    running emulator via FIRESTORE_EMULATOR_HOST, enables it; the full\n' +
        '    grammar is also compiled by `npm run test:rules` in emulator-guards.yml.',
    )
  }
  return broken === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error('check:rules-parse crashed:', error)
      process.exit(2)
    },
  )
}
