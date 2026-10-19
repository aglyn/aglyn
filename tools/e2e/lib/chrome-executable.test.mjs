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

// Self-test for the shared Chrome launch options: Playwright's own disabled
// features must still be readable from the installed playwright-core, and the
// macOS switch must carry all of them plus the code-sign clone feature, since
// Chrome honors only the last `--disable-features` it is given.

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  CODE_SIGN_CLONE_FEATURE,
  chromeExecutable,
  noCodeSignCloneArgs,
  openCodeSignClones,
  playwrightDisabledFeatures,
  reapCodeSignClones,
} from './chrome-executable.mjs'

describe('playwrightDisabledFeatures', () => {
  it('reads the list from the installed playwright-core', () => {
    const features = playwrightDisabledFeatures()
    assert.ok(features, 'the installed playwright-core no longer defines disabledFeatures where expected')
    assert.ok(features.length > 3, `only read ${features.length} features`)
    for (const feature of features) assert.match(feature, /^[\w-]+$/)
  })

  it('skips the comments between the names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chrome-executable-'))
    mkdirSync(join(dir, 'lib'))
    writeFileSync(
      join(dir, 'lib/coreBundle.js'),
      [
        'disabledFeatures = [',
        '  // See https://github.com/microsoft/playwright/issues/14047',
        '  "AvoidUnnecessaryBeforeUnloadCheckSync",',
        '  // Its not working in unofficial builds.',
        '  "LensOverlay"',
        '];',
      ].join('\n'),
    )
    assert.deepEqual(playwrightDisabledFeatures(dir), ['AvoidUnnecessaryBeforeUnloadCheckSync', 'LensOverlay'])
  })

  it('answers null for a layout it does not recognize', () => {
    assert.equal(playwrightDisabledFeatures(mkdtempSync(join(tmpdir(), 'chrome-executable-'))), null)
  })
})

describe('noCodeSignCloneArgs', () => {
  it("keeps Playwright's features in the one switch", () => {
    assert.deepEqual(noCodeSignCloneArgs(['Translate', 'PaintHolding']), [
      `--disable-features=Translate,PaintHolding,${CODE_SIGN_CLONE_FEATURE}`,
    ])
  })

  it('adds nothing when the list could not be read', () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      assert.deepEqual(noCodeSignCloneArgs(null), [])
    } finally {
      console.warn = warn
    }
  })
})

const BETA = '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta'

describe('openCodeSignClones', () => {
  const lsof = 'p64314\nftxt\nn/var/folders/x/T/../X/com.google.Chrome.beta.code_sign_clone/code_sign_clone.o0MACF/Google Chrome Beta.app.bundle/Contents/MacOS/Google Chrome Beta\n'

  it('names the copies lsof saw open', () => {
    assert.deepEqual([...openCodeSignClones(lsof, `${BETA}\n`)], ['code_sign_clone.o0MACF'])
  })

  it('answers null when a running Chrome made a copy lsof did not see', () => {
    assert.equal(openCodeSignClones('', `${BETA} --flag-switches-begin\n`), null)
  })

  it('counts neither helpers nor a Chrome launched with the copy switched off', () => {
    const ps = [
      `${BETA} --headless --disable-features=Translate,${CODE_SIGN_CLONE_FEATURE}`,
      '/Applications/Google Chrome Beta.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Beta Helper (Renderer).app/Contents/MacOS/Google Chrome Beta Helper (Renderer) --type=renderer',
    ].join('\n')
    assert.deepEqual([...openCodeSignClones('', ps)], [])
  })
})

describe('reapCodeSignClones', () => {
  const now = Date.now()
  const copies = () => {
    const root = mkdtempSync(join(tmpdir(), 'chrome-executable-'))
    const flavor = join(root, 'com.google.Chrome.beta.code_sign_clone')
    const make = (name, ageMinutes) => {
      const path = join(flavor, name)
      mkdirSync(path, { recursive: true })
      const at = new Date(now - ageMinutes * 60_000)
      utimesSync(path, at, at)
      return path
    }
    return {
      root,
      left: make('code_sign_clone.left', 60),
      open: make('code_sign_clone.open', 60),
      fresh: make('code_sign_clone.fresh', 2),
      other: make('unrelated', 60),
    }
  }
  const quietly = (run) => {
    const warn = console.warn
    console.warn = () => {}
    try {
      return run()
    } finally {
      console.warn = warn
    }
  }

  it('removes only old copies nothing has open', () => {
    const { root, left, open, fresh, other } = copies()
    const removed = quietly(() =>
      reapCodeSignClones({ root, readOpen: () => new Set(['code_sign_clone.open']), now }),
    )
    assert.deepEqual(removed, [left])
    assert.equal(existsSync(left), false)
    for (const kept of [open, fresh, other]) assert.ok(existsSync(kept), kept)
  })

  it('removes nothing when it cannot tell which copies are open', () => {
    const { root, left } = copies()
    assert.deepEqual(reapCodeSignClones({ root, readOpen: () => null, now }), [])
    assert.ok(existsSync(left))
  })

  it('does not ask lsof when no copy is old enough', () => {
    const root = mkdtempSync(join(tmpdir(), 'chrome-executable-'))
    const readOpen = () => assert.fail('lsof was asked')
    assert.deepEqual(reapCodeSignClones({ root, readOpen, now }), [])
  })
})

describe('chromeExecutable', () => {
  it('prefers the explicit path', () => {
    assert.equal(chromeExecutable({ explicit: '/opt/chrome' }).executablePath, '/opt/chrome')
  })

  it('switches the clone off only on macOS', () => {
    const { args } = chromeExecutable({ explicit: '/opt/chrome' })
    if (process.platform === 'darwin') {
      assert.equal(args?.length, 1)
      assert.ok(args[0].endsWith(`,${CODE_SIGN_CLONE_FEATURE}`))
    } else {
      assert.equal(args, undefined)
    }
  })
})
