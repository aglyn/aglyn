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

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  evaluateHotfixDispatches,
  isDispatchable,
  pushReachesProduction,
  sweepList,
} from './hotfix-dispatches.mjs'

const listed = `name: Publish
on:
  push:
    branches:
      # a comment inside the filter
      - production
  workflow_dispatch:
    inputs:
      publish:
        type: boolean
jobs: {}
`

const inline = `on:
  push:
    branches: [main, production]
    paths:
      - 'docker/**'
jobs: {}
`

const sameIndent = `on:
  push:
    branches:
    - production
jobs: {}
`

const mainOnly = `on:
  push:
    branches: [main]
  workflow_dispatch:
jobs: {}
`

const tagsOnly = `on:
  push:
    tags:
      - 'v*'
jobs: {}
`

const anyBranch = `on: [push, workflow_dispatch]
jobs: {}
`

const sweep = (dispatch, skip) => `name: Auto-merge green PRs
on:
  workflow_dispatch:
jobs:
  sweep:
    env:
      PRODUCTION_DISPATCH: >-
        ${dispatch}
      PRODUCTION_NOT_DISPATCHED: >-
        ${skip}
`

describe('pushReachesProduction', () => {
  it('reads a list and an inline array of branches', () => {
    assert.equal(pushReachesProduction(listed), true)
    assert.equal(pushReachesProduction(inline), true)
    assert.equal(pushReachesProduction(sameIndent), true)
  })

  it('leaves out a push to another branch or to tags', () => {
    assert.equal(pushReachesProduction(mainOnly), false)
    assert.equal(pushReachesProduction(tagsOnly), false)
  })

  it('counts a push with no branch filter', () => {
    assert.equal(pushReachesProduction(anyBranch), true)
  })
})

describe('isDispatchable', () => {
  it('finds workflow_dispatch in either form of on:', () => {
    assert.equal(isDispatchable(listed), true)
    assert.equal(isDispatchable(anyBranch), true)
    assert.equal(isDispatchable(inline), false)
  })
})

describe('sweepList', () => {
  it('reads a folded list across lines', () => {
    const text = sweep('a.yml b.yml\n        c.yml', 'd.yml')
    assert.deepEqual(sweepList(text, 'PRODUCTION_DISPATCH'), [
      'a.yml',
      'b.yml',
      'c.yml',
    ])
    assert.deepEqual(sweepList(text, 'PRODUCTION_NOT_DISPATCHED'), ['d.yml'])
    assert.equal(sweepList(text, 'MISSING'), null)
  })
})

describe('evaluateHotfixDispatches', () => {
  const workflows = (dispatch, skip) => ({
    'auto-merge-green.yml': sweep(dispatch, skip),
    'publish.yml': listed,
    'images.yml': inline,
    'main-only.yml': mainOnly,
  })

  it('passes when every production workflow is in one list', () => {
    const result = evaluateHotfixDispatches(
      workflows('publish.yml', 'images.yml'),
    )
    assert.deepEqual(result.problems, [])
    assert.equal(result.ok, true)
  })

  it('fails on a production workflow in neither list', () => {
    const result = evaluateHotfixDispatches(
      workflows('publish.yml', 'none.yml'),
    )
    assert.equal(result.ok, false)
    assert.ok(
      result.problems.some((p) =>
        p.startsWith('images.yml runs on a push to production'),
      ),
    )
    assert.ok(
      result.problems.some((p) => p.startsWith('none.yml is in the sweep')),
    )
  })

  it('fails on a dispatch the workflow cannot take', () => {
    const result = evaluateHotfixDispatches(
      workflows('publish.yml images.yml', 'x'),
    )
    assert.ok(
      result.problems.includes(
        'images.yml is in PRODUCTION_DISPATCH but has no workflow_dispatch trigger.',
      ),
    )
  })

  it('fails on a listed workflow production does not start', () => {
    const result = evaluateHotfixDispatches(
      workflows('publish.yml main-only.yml', 'images.yml'),
    )
    assert.ok(
      result.problems.includes(
        "main-only.yml is in the sweep's lists but a push to production does not start it.",
      ),
    )
  })
})
