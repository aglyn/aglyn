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
 * Pins the AGL-1425 disk preflight.
 *
 *   node --test tools/scripts/lib/disk-space.test.mjs
 *
 * This check can fail a dev server's `serve` target, so it has two dangerous
 * failure modes and they point in opposite directions: blocking a healthy
 * machine (everyone loses their dev loop over a parsing bug), and passing a
 * full one (the check looks like coverage while the original incident repeats
 * unchanged). Every case below is one or the other.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  DEFAULT_FREE_SPACE_THRESHOLDS,
  describeFreeSpace,
  evaluateFreeSpace,
  normaliseThresholds,
} from './disk-space.mjs'

const GIB = 1024 * 1024 * 1024
const atGib = (n) => n * GIB

/** The thresholds most cases use, stated explicitly so they read locally. */
const thresholds = { criticalGib: 10, warnGib: 30 }

test('a healthy disk passes and does not block', () => {
  const verdict = evaluateFreeSpace({ freeBytes: atGib(135), thresholds })
  assert.equal(verdict.level, 'ok')
  assert.equal(verdict.blocking, false)
})

test('the actual incident reading blocks', () => {
  // 1.8 GiB free of 460 GiB, the state the machine reached on 2026-08-11.
  const verdict = evaluateFreeSpace({ freeBytes: atGib(1.8), thresholds })
  assert.equal(verdict.level, 'critical')
  assert.equal(verdict.blocking, true)
})

test('between the marks it warns but still starts', () => {
  const verdict = evaluateFreeSpace({ freeBytes: atGib(20), thresholds })
  assert.equal(verdict.level, 'warn')
  assert.equal(
    verdict.blocking,
    false,
    'a warning that blocks is just a lower critical threshold',
  )
})

test('exactly at a threshold is the threshold being met, not missed', () => {
  // An off-by-one here fails a machine that is precisely as healthy as asked.
  assert.equal(
    evaluateFreeSpace({ freeBytes: atGib(10), thresholds }).level,
    'warn',
  )
  assert.equal(
    evaluateFreeSpace({ freeBytes: atGib(30), thresholds }).level,
    'ok',
  )
})

test('just under a threshold does cross it', () => {
  const justUnderCritical = evaluateFreeSpace({
    freeBytes: atGib(10) - 1,
    thresholds,
  })
  assert.equal(justUnderCritical.level, 'critical')
  assert.equal(
    evaluateFreeSpace({ freeBytes: atGib(30) - 1, thresholds }).level,
    'warn',
  )
})

test('an empty disk blocks rather than reading as unknown', () => {
  const verdict = evaluateFreeSpace({ freeBytes: 0, thresholds })
  assert.equal(verdict.level, 'critical')
  assert.equal(verdict.blocking, true)
})

/**
 * The measurement-failure family. Every one of these must be non-blocking:
 * `readFreeBytes` returns null on any platform without statfs, and a dev loop
 * that dies because the check could not measure is worse than no check.
 */
for (const [label, freeBytes] of [
  ['null', null],
  ['undefined', undefined],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['a negative reading', -1],
  ['a string', '40'],
]) {
  test(`${label} reads as unknown and never blocks`, () => {
    const verdict = evaluateFreeSpace({ freeBytes, thresholds })
    assert.equal(verdict.level, 'unknown')
    assert.equal(verdict.blocking, false)
    assert.equal(verdict.freeBytes, null)
  })
}

test('the escape hatch wins over an empty disk', () => {
  const verdict = evaluateFreeSpace({
    freeBytes: 0,
    thresholds,
    disabled: true,
  })
  assert.equal(verdict.level, 'disabled')
  assert.equal(verdict.blocking, false)
})

test('omitted thresholds fall back to the shipped defaults', () => {
  const verdict = evaluateFreeSpace({ freeBytes: atGib(5) })
  assert.equal(verdict.criticalGib, DEFAULT_FREE_SPACE_THRESHOLDS.criticalGib)
  assert.equal(verdict.warnGib, DEFAULT_FREE_SPACE_THRESHOLDS.warnGib)
  assert.equal(verdict.blocking, true)
})

/**
 * Threshold parsing. These arrive as `--flag=` strings and env vars, so the
 * junk values are routine. The one that matters is the empty string: it comes
 * from an unset-but-present env var, and `Number('')` is 0, which would
 * silently disable the check while still looking configured.
 */
test('an empty-string threshold falls back instead of becoming zero', () => {
  const { criticalGib } = normaliseThresholds({ criticalGib: '' })
  assert.equal(criticalGib, DEFAULT_FREE_SPACE_THRESHOLDS.criticalGib)
  assert.equal(
    evaluateFreeSpace({ freeBytes: atGib(2), thresholds: { criticalGib: '' } })
      .blocking,
    true,
  )
})

test('unparseable and negative thresholds fall back', () => {
  assert.equal(normaliseThresholds({ criticalGib: 'abc' }).criticalGib, 10)
  assert.equal(normaliseThresholds({ criticalGib: -5 }).criticalGib, 10)
  assert.equal(normaliseThresholds({ warnGib: undefined }).warnGib, 30)
})

test('numeric strings are honoured, since env vars are always strings', () => {
  const { criticalGib, warnGib } = normaliseThresholds({
    criticalGib: '50',
    warnGib: '80',
  })
  assert.equal(criticalGib, 50)
  assert.equal(warnGib, 80)
  assert.equal(
    evaluateFreeSpace({
      freeBytes: atGib(40),
      thresholds: { criticalGib: '50' },
    }).blocking,
    true,
  )
})

test('an explicit zero critical threshold is honoured, not treated as unset', () => {
  // Distinct from '' — someone passing 0 means "only block on a truly full
  // disk", and silently restoring 10 would override a deliberate choice.
  const { criticalGib } = normaliseThresholds({ criticalGib: 0 })
  assert.equal(criticalGib, 0)
  assert.equal(
    evaluateFreeSpace({
      freeBytes: 0,
      thresholds: { criticalGib: 0, warnGib: 0 },
    }).blocking,
    false,
  )
})

test('an inverted pair clamps warn up, never reporting warn below critical', () => {
  // critical raised past warn means "block me earlier". If warn stayed at 30
  // the 40 GiB reading below would report `warn` while 35 GiB reported
  // `critical` — the louder signal unreachable underneath the quieter one.
  const { criticalGib, warnGib } = normaliseThresholds({
    criticalGib: 50,
    warnGib: 30,
  })
  assert.equal(criticalGib, 50)
  assert.equal(warnGib, 50)
  const verdict = evaluateFreeSpace({
    freeBytes: atGib(40),
    thresholds: { criticalGib: 50, warnGib: 30 },
  })
  assert.equal(verdict.level, 'critical')
  assert.equal(verdict.blocking, true)
})

/**
 * The message is the entire feature. The incident cost what it did because
 * the failure never named the disk or the path, so a critical verdict that
 * printed a bare number would rebuild the original problem.
 */
test('the blocking message names the path, the fix and the override', () => {
  const lines = describeFreeSpace(
    evaluateFreeSpace({ freeBytes: atGib(2), thresholds }),
  ).join('\n')
  assert.match(lines, /\.next\/dev\/cache\/turbopack/)
  assert.match(lines, /clean:next:prune/)
  assert.match(lines, /DEV_DISK_CHECK=off/)
  assert.match(lines, /AGL-1425/)
  assert.match(lines, /2\.0 GiB/, 'the reader needs the actual number')
})

test('the warning message is actionable too', () => {
  const lines = describeFreeSpace(
    evaluateFreeSpace({ freeBytes: atGib(20), thresholds }),
  ).join('\n')
  assert.match(lines, /clean:next:prune/)
  assert.match(lines, /20\.0 GiB/)
})

test('every level produces at least one line', () => {
  for (const freeBytes of [atGib(135), atGib(20), atGib(2), null]) {
    assert.ok(
      describeFreeSpace(evaluateFreeSpace({ freeBytes, thresholds })).length >
        0,
    )
  }
  assert.ok(
    describeFreeSpace(evaluateFreeSpace({ freeBytes: 0, disabled: true }))
      .length > 0,
  )
})
