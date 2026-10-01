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
 */
// The consumer proof's own logic, without building, installing or opening
// anything (AGL-3201). The proof itself takes minutes and the network; this
// holds the parts that decide what it installs and what it refuses.
//
//   npm run test:consumer-proof

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  STORIES,
  askedFor,
  awaitPublished,
  consumerManifest,
  exampleProblems,
  examplesWithoutStory,
  parseArgs,
} from './consumer-proof.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

describe('an example is the proof', () => {
  const manifest = {
    scripts: { build: 'vite build', check: 'node check.js' },
    dependencies: { '@aglyn/besigner': '^1.0.0-beta.219', '@aglyn/aglyn': '^1.0.0-beta.219', react: '^19.2.0' },
  }

  it('asks for the @aglyn packages it names, and nothing else', () => {
    assert.deepEqual(askedFor(manifest), ['@aglyn/aglyn', '@aglyn/besigner'])
  })

  it('installs the version under test from the registry, leaving everything else as written', () => {
    const installed = consumerManifest(manifest, { version: '1.0.0-beta.220' })
    assert.deepEqual(installed.dependencies, { '@aglyn/besigner': '1.0.0-beta.220', '@aglyn/aglyn': '1.0.0-beta.220', react: '^19.2.0' })
    assert.equal(manifest.dependencies['@aglyn/aglyn'], '^1.0.0-beta.219', 'the example itself is not rewritten')
  })

  it('names EVERY packed package, so a sibling pin finds its tarball and not the registry', () => {
    // A packed version is by definition not published yet, so a sibling the
    // example does not name directly would resolve from nowhere else.
    const tarballs = { '@aglyn/aglyn': '/t/aglyn.tgz', '@aglyn/besigner': '/t/besigner.tgz', '@aglyn/shared-util-tools': '/t/tools.tgz' }
    const installed = consumerManifest(manifest, { version: '1.0.0-beta.220', tarballs })
    assert.equal(installed.dependencies['@aglyn/shared-util-tools'], 'file:/t/tools.tgz')
    assert.equal(installed.dependencies['@aglyn/aglyn'], 'file:/t/aglyn.tgz')
    assert.equal(installed.dependencies.react, '^19.2.0')
  })

  it('accepts an example whose ranges admit the version under test', () => {
    assert.deepEqual(exampleProblems(manifest, { version: '1.0.0-beta.230', examplePath: 'x' }), [])
    assert.deepEqual(exampleProblems(manifest, { version: '1.0.0', examplePath: 'x' }), [])
  })

  it('refuses a range that would install something nobody proved', () => {
    const problems = exampleProblems(manifest, { version: '2.0.0', examplePath: 'examples/consumers/x' })
    assert.equal(problems.length, 2, problems.join('\n'))
    assert.match(problems[0], /does not admit 2\.0\.0.*"\^2\.0\.0"/)
  })

  it('refuses an example with no build or no check, because the proof runs both', () => {
    const problems = exampleProblems({ dependencies: manifest.dependencies }, { version: '1.0.0', examplePath: 'x' })
    assert.ok(problems.some((line) => line.includes('"build"')))
    assert.ok(problems.some((line) => line.includes('"check"')))
  })
})

describe('the examples in this repo', () => {
  const rootVersion = readJson('package.json').version

  it('each has a story, and each story an example', () => {
    assert.deepEqual(examplesWithoutStory(ROOT), [])
    for (const story of Object.values(STORIES)) assert.ok(readJson(`${story.example}/package.json`), story.example)
  })

  it('each admits the version this tree carries, so the promotion PR can prove it', () => {
    for (const [name, story] of Object.entries(STORIES)) {
      const problems = exampleProblems(readJson(`${story.example}/package.json`), { version: rootVersion, examplePath: story.example })
      assert.deepEqual(problems, [], name)
    }
  })

  it('each says what it must not need and what a person does with it', () => {
    for (const [name, story] of Object.entries(STORIES)) {
      assert.ok(story.forbidden.length, `${name} names nothing it must do without`)
      assert.ok(story.browser?.some((step) => step.click), `${name} clicks nothing in the browser`)
    }
  })

  it('a story never asks for a package it says it must not need', () => {
    for (const [name, story] of Object.entries(STORIES)) {
      const manifest = readJson(`${story.example}/package.json`)
      const asked = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
      assert.deepEqual(story.forbidden.filter((forbidden) => asked.has(forbidden)), [], name)
    }
  })
})

describe('the registry proof waits out the read lag', () => {
  it('asks again until every package answers, then stops', async () => {
    // `a` is not readable yet on the first round; `b` is.
    const answers = { a: [null, '1.0.0'], b: ['1.0.0'] }
    const asked = []
    const missing = await awaitPublished(['a', 'b'], '1.0.0', {
      view: async (name) => {
        asked.push(name)
        return answers[name].shift()
      },
      sleep: async () => {},
    })
    assert.deepEqual(missing, [])
    // `b` answered on the first round and is not asked again.
    assert.deepEqual(asked, ['a', 'b', 'a'])
  })

  it('names what never arrived, after the last attempt', async () => {
    const missing = await awaitPublished(['a', 'b'], '1.0.0', {
      view: async (name) => (name === 'a' ? '1.0.0' : null),
      attempts: 3,
      sleep: async () => {},
    })
    assert.deepEqual(missing, ['b'])
  })
})

describe('the command line', () => {
  it('packs by default and reads the registry only when asked', () => {
    assert.deepEqual(parseArgs(['logic-only']), { stories: ['logic-only'], registry: null, keep: false, browser: true })
    assert.equal(parseArgs(['logic-only', '--registry']).registry, '')
    assert.equal(parseArgs(['logic-only', '--registry=1.0.0-beta.219']).registry, '1.0.0-beta.219')
    assert.equal(parseArgs(['logic-only', '--no-browser']).browser, false)
  })

  it('refuses a flag it does not know rather than ignoring it', () => {
    assert.throws(() => parseArgs(['logic-only', '--registy']), /unknown flag --registy/)
  })
})
