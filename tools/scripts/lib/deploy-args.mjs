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

// Argument parsing for the four deploy scripts, which all SHIP SOMETHING when
// they run (AGL-1489).
//
// ── WHY THESE SCRIPTS MAY NOT IGNORE AN ARGUMENT ──────────────────────────
//
// The three rules deploys read exactly one flag, as
// `process.argv.includes('--allow-dirty')`, and look at nothing else. An
// argument they do not recognise is therefore not refused and not reported —
// it is DISCARDED, and the script proceeds to push rules to the live project.
//
// `--help` is the case that fires. Asking a deploy script what it does is the
// single most reasonable thing an operator can type before running it for the
// first time, and on 2026-08-28 `deploy-firestore-rules.mjs --help` deployed
// the Firestore rules to `aglyn-main`. It was survivable only by luck: the
// worktree happened to be clean, so what shipped was the committed file. With
// an uncommitted edit in the tree the same keystroke ships that edit.
//
// The same keystroke does the same thing on the storage and database rules,
// which is why this is a shared parser and not a fix in one file.
//
// ── FAIL CLOSED, WHICH IS THE OPPOSITE OF THE USUAL CONVENIENCE ───────────
//
// Most CLIs ignore what they do not understand. A deploy must not: an
// unrecognised flag means the operator believes something is in effect that
// is not, and every such belief here is about what reaches production. So an
// unknown argument EXITS 2 without deploying, and a typo — `--dryrun`,
// `--dry_run`, `-n` — refuses rather than silently deploying for real.
//
// Exit codes are the same three the deploy scripts already use: 0 for a
// completed run (including `--help`), 2 for "could not deploy", which is
// deliberately NOT 1, so a refusal is distinguishable from a deploy that ran
// and failed.

/** Printed for `--help`, and again on stderr when an argument is refused. */
function usageText({ command, summary, flags }) {
  const width = Math.max(...flags.map((one) => one.flag.length))
  return [
    summary,
    '',
    `Usage: node tools/scripts/${command}.mjs [options]`,
    '',
    'Options:',
    ...flags.map(
      (one) => `  ${one.flag.padEnd(width)}  ${one.describe}`,
    ),
    `  ${'--help, -h'.padEnd(width)}  Print this and exit WITHOUT deploying.`,
  ].join('\n')
}

/**
 * Parse a deploy script's arguments, or exit.
 *
 * ⚠️ This function EXITS the process for `--help` (0) and for any unrecognised
 * argument (2). That is the point: returning a partial parse and letting the
 * caller decide would put the "did we understand this?" judgement back in the
 * four call sites that got it wrong.
 *
 * @param {object} spec
 * @param {string}   spec.command  script basename, for the usage line
 * @param {string}   spec.summary  one line saying what running it DOES
 * @param {{flag: string, describe: string, key: string, value?: 'string'}[]} spec.flags
 * @param {string[]} [spec.argv]   defaults to this process's arguments
 * @param {{log: Function, error: Function, exit: Function}} [spec.io] for tests
 * @returns {Record<string, string|boolean>} one key per flag, defaults applied
 */
export function parseDeployArgs({ command, summary, flags, argv, io }) {
  const out = io ?? { log: console.log, error: console.error, exit: process.exit }
  const args = argv ?? process.argv.slice(2)
  const usage = usageText({ command, summary, flags })

  const parsed = {}
  for (const one of flags) parsed[one.key] = one.value === 'string' ? null : false

  for (const arg of args) {
    // `--` is the conventional end-of-options marker and carries no meaning
    // for a script that takes no positional arguments.
    if (arg === '--') continue
    if (arg === '--help' || arg === '-h') {
      out.log(usage)
      return out.exit(0)
    }
    const valued = flags.find(
      (one) => one.value === 'string' && arg.startsWith(`${one.flag}=`),
    )
    if (valued) {
      parsed[valued.key] = arg.slice(valued.flag.length + 1)
      continue
    }
    const boolean = flags.find((one) => one.value !== 'string' && one.flag === arg)
    if (boolean) {
      parsed[boolean.key] = true
      continue
    }
    // The refusal. Named explicitly so the operator sees WHICH token was not
    // understood, and told plainly that nothing was deployed — a deploy
    // script that exits quietly is indistinguishable from one that ran.
    out.error(
      `Unknown argument ${JSON.stringify(arg)} — NOTHING WAS DEPLOYED.\n\n` +
        `${usage}\n\n` +
        'Exiting 2 (could not deploy). That is NOT the same as a clean run.',
    )
    return out.exit(2)
  }
  return parsed
}

/** The `--allow-dirty` flag, identically worded on all four deploys. */
export const ALLOW_DIRTY_FLAG = {
  flag: '--allow-dirty',
  key: 'allowDirty',
  describe:
    'Deploy the worktree copy even with uncommitted edits to it. Also the ' +
    'escape hatch for a tarball checkout with no git.',
}
