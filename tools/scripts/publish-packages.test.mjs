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
import {
  distTagFor,
  hasStableRelease,
  isCredentialFailure,
  missingFrom,
  prereleaseLabelOf,
  publishAll,
  publishedVersions,
} from './publish-packages.mjs'

describe('the dist-tag a version publishes under', () => {
  /** A package that has shipped a real release, and one that never has. */
  const WITH_STABLE = ['0.9.0', '1.0.0', '1.0.1-beta.1']
  const BETAS_ONLY = ['1.0.0-beta.1', '1.0.0-beta.142']

  it('keeps a prerelease off latest once a RELEASE exists to be latest', () => {
    // `npm install @aglyn/aglyn` hands out `latest`; a beta must not be it
    // when there is something better to be.
    assert.equal(distTagFor('1.0.0-beta.142', WITH_STABLE), 'beta')
    assert.equal(distTagFor('2.1.0-rc.1', WITH_STABLE), 'rc')
  })

  it('publishes a release as latest', () => {
    assert.equal(distTagFor('1.0.0', BETAS_ONLY), 'latest')
    assert.equal(distTagFor('0.1.2', WITH_STABLE), 'latest')
  })

  it('gives latest to a prerelease when NOTHING stable has ever shipped', () => {
    /*
     * AGL-3201. npm sets `latest` on a package's first publish whatever
     * `--tag` says, so these libs pinned it to their earliest beta — which
     * for `1.0.0-beta.143` was the one build a consumer could not load at
     * all — and every later beta went to `beta`, so `latest` never moved
     * again. Between "the default is a prerelease" and "the default does not
     * work", the first is the lesser harm.
     */
    assert.equal(distTagFor('1.0.0-beta.146', BETAS_ONLY), 'latest')
    assert.equal(distTagFor('1.0.0-beta.146', []), 'latest')
    assert.equal(distTagFor('1.0.0-beta.146', undefined), 'latest')
  })

  it('CORRECTS ITSELF the moment a release ships', () => {
    // The condition is the registry's own answer, per package, so nothing
    // has to be remembered or undone on the day 1.0.0 goes out.
    assert.equal(distTagFor('1.0.0-beta.147', BETAS_ONLY), 'latest')
    assert.equal(distTagFor('1.0.0-beta.147', [...BETAS_ONLY, '1.0.0']), 'beta')
  })

  it('reads a prerelease label, and a release as none', () => {
    assert.equal(prereleaseLabelOf('1.0.0-beta.142'), 'beta')
    assert.equal(prereleaseLabelOf('1.0.0'), null)
    assert.equal(prereleaseLabelOf(undefined), null)
    assert.equal(hasStableRelease(BETAS_ONLY), false)
    assert.equal(hasStableRelease(WITH_STABLE), true)
    assert.equal(hasStableRelease([]), false)
  })
})

describe("reading what the registry holds for a package", () => {
  it('answers a bare string as one version, which is how npm reports one', () => {
    // `npm view <pkg> versions --json` answers a STRING when the package has
    // exactly one version and an array otherwise. Read as an array, that
    // string would be split into characters — and a package with one stable
    // release would look like it had none.
    assert.deepEqual(publishedVersions('@aglyn/x', () => '"1.0.0"'), ['1.0.0'])
    assert.equal(hasStableRelease(publishedVersions('@aglyn/x', () => '"1.0.0"')), true)
  })

  it('answers an array as itself, and a missing package as nothing', () => {
    assert.deepEqual(
      publishedVersions('@aglyn/x', () => '["1.0.0-beta.1","1.0.0"]'),
      ['1.0.0-beta.1', '1.0.0'],
    )
    assert.deepEqual(publishedVersions('@aglyn/x', () => null), [])
  })

  it('throws on an answer it cannot read, rather than calling it empty', () => {
    // An empty answer means "no stable release", which would put a
    // prerelease on `latest` for a package that has one.
    assert.throws(() => publishedVersions('@aglyn/x', () => 'not json'), /could not read/)
    assert.throws(() => publishedVersions('@aglyn/x', () => '{"a":1}'), /shape this cannot read/)
  })
})

describe('a run publishes what the registry is missing', () => {
  const packages = [
    { name: '@aglyn/aglyn', version: '1.0.0' },
    { name: '@aglyn/cli', version: '0.1.2' },
  ]

  const REGISTRY = {
    '@aglyn/aglyn': ['1.0.0-beta.1'],
    '@aglyn/cli': ['0.1.2'],
  }

  it('skips a version that is already out, so a second run publishes nothing twice', () => {
    assert.deepEqual(
      missingFrom(packages, (name) => REGISTRY[name] ?? []).map((entry) => entry.name),
      ['@aglyn/aglyn'],
    )
  })

  it('carries the versions it found, so the tag costs no second round trip', () => {
    const [entry] = missingFrom(packages, (name) => REGISTRY[name] ?? [])
    assert.deepEqual(entry.published, ['1.0.0-beta.1'])
  })

  it('lets a registry that did not answer stop the run, not read as "missing"', () => {
    // Guessing "not published" on an outage would try to overwrite a version.
    assert.throws(() => missingFrom(packages, () => { throw new Error('ETIMEDOUT') }), /ETIMEDOUT/)
  })
})

describe('one package that will not publish does not strand the rest', () => {
  const entries = [
    { name: '@aglyn/a', version: '1.0.0' },
    { name: '@aglyn/b', version: '1.0.0' },
    { name: '@aglyn/c', version: '1.0.0' },
  ]

  it('publishes past a package the registry refuses', () => {
    /*
     * ⛔ THE CASE THAT COST FOUR RELEASES (2026-09-23). Entries are sorted by
     * name, so a new package with no trust row answered E404 and the two
     * sorting after it were never attempted — three releases behind on the
     * registry, with nothing wrong with either of them.
     */
    const tried = []
    const result = publishAll(entries, (entry) => {
      tried.push(entry.name)
      if (entry.name === '@aglyn/a') {
        throw new Error('E404 Not Found - PUT https://registry.npmjs.org/@aglyn%2fa')
      }
    })
    assert.deepEqual(tried, ['@aglyn/a', '@aglyn/b', '@aglyn/c'])
    assert.equal(result.published, 2)
    assert.equal(result.abandoned.length, 0)
    assert.deepEqual(
      result.failures.map((failure) => failure.name),
      ['@aglyn/a'],
    )
  })

  it('still REPORTS the failure — carrying on is not forgiving it', () => {
    // The run exits non-zero on this; `main` reads `failures.length`. A
    // resilient publisher that went green would be worse than the abort it
    // replaced.
    const result = publishAll(entries, () => {
      throw new Error('E404 Not Found')
    })
    assert.equal(result.published, 0)
    assert.equal(result.failures.length, 3)
  })

  it('STOPS on a credential, because every one after it fails the same way', () => {
    // The other direction, and the reason this is not just a try/catch: forty
    // identical EOTP errors bury the one line that says what to fix.
    const tried = []
    const result = publishAll(entries, (entry) => {
      tried.push(entry.name)
      throw new Error('npm error code EOTP\nnpm error This operation requires a one-time password')
    })
    assert.deepEqual(tried, ['@aglyn/a'])
    assert.deepEqual(
      result.abandoned.map((entry) => entry.name),
      ['@aglyn/b', '@aglyn/c'],
    )
    assert.equal(result.failures.length, 1)
  })

  it('tells a credential failure from a package failure', () => {
    // The E404 is the one that must NOT abort: it is what a package with no
    // trusted-publisher row answers, and it is about that name alone.
    assert.equal(isCredentialFailure('npm error code EOTP'), true)
    assert.equal(isCredentialFailure('npm error code ENEEDAUTH'), true)
    assert.equal(isCredentialFailure('npm error 401 Unauthorized'), true)
    assert.equal(isCredentialFailure('E404 Not Found - PUT https://…'), false)
    assert.equal(isCredentialFailure('npm error 403 Forbidden'), false)
    assert.equal(isCredentialFailure(undefined), false)
  })
})
