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
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { distTagFor, missingFrom } from './publish-packages.mjs'

describe('the dist-tag a version publishes under', () => {
  it('keeps a prerelease off latest, under its own label', () => {
    // `npm install @aglyn/aglyn` hands out `latest`; a beta must not be it.
    assert.equal(distTagFor('1.0.0-beta.142'), 'beta')
    assert.equal(distTagFor('2.1.0-rc.1'), 'rc')
  })

  it('publishes a release as latest', () => {
    assert.equal(distTagFor('1.0.0'), 'latest')
    assert.equal(distTagFor('0.1.2'), 'latest')
  })
})

describe('a run publishes what the registry is missing', () => {
  const packages = [
    { name: '@aglyn/aglyn', version: '1.0.0' },
    { name: '@aglyn/cli', version: '0.1.2' },
  ]

  it('skips a version that is already out, so a second run publishes nothing twice', () => {
    const published = new Set(['@aglyn/cli@0.1.2'])
    assert.deepEqual(
      missingFrom(packages, (name, version) => published.has(`${name}@${version}`)).map((entry) => entry.name),
      ['@aglyn/aglyn'],
    )
  })

  it('lets a registry that did not answer stop the run, not read as "missing"', () => {
    // Guessing "not published" on an outage would try to overwrite a version.
    assert.throws(() => missingFrom(packages, () => { throw new Error('ETIMEDOUT') }), /ETIMEDOUT/)
  })
})
