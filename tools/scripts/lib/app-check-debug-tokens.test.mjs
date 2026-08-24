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

// Tests for the App Check debug-token registration check (AGL-2402).
//
// The verdict is exercised in BOTH directions against stubbed responses,
// because the green direction cannot be reached against the live project until
// someone actually deletes the tokens — and a check whose pass path has never
// run once is not a check.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  debugTokensUrl,
  fetchApps,
  fetchDebugTokens,
  formatReport,
  requestHeaders,
  searchAppsUrl,
  summarize,
} from './app-check-debug-tokens.mjs'

const ok = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

describe('summarize', () => {
  it('is clean only when every app has zero tokens', () => {
    const summary = summarize([
      { appId: 'a', tokens: [] },
      { appId: 'b', tokens: [] },
    ])
    assert.equal(summary.ok, true)
    assert.equal(summary.total, 0)
    assert.equal(summary.apps, 2)
  })

  it('is red when any app has one, and counts across apps', () => {
    const summary = summarize([
      { appId: 'a', tokens: [{ displayName: 'ci' }] },
      { appId: 'b', tokens: [] },
      { appId: 'c', tokens: [{ displayName: 'x' }, { displayName: 'y' }] },
    ])
    assert.equal(summary.ok, false)
    assert.equal(summary.total, 3)
    assert.equal(summary.offenders.length, 2)
  })

  it('does not treat an empty app list as clean by arithmetic alone', () => {
    // `summarize([])` is vacuously ok — which is CORRECT for a pure fold and
    // WRONG as a verdict, so the CLI exits 2 before ever calling it with an
    // empty list. Pinned here so that the CLI's guard cannot be deleted as
    // redundant on the belief that this function covers it.
    assert.equal(summarize([]).ok, true)
  })
})

describe('fetchDebugTokens', () => {
  it('reads the metadata the console shows', async () => {
    const tokens = await fetchDebugTokens({
      token: 't',
      projectId: 'p',
      appId: 'app-1',
      fetchImpl: async () =>
        ok({
          debugTokens: [
            {
              name: 'projects/1/apps/app-1/debugTokens/ZGVhZGJlZWY',
              displayName: 'ci-runner',
              updateTime: '2022-02-10T10:53:27Z',
            },
          ],
        }),
    })
    assert.deepEqual(tokens, [
      {
        id: 'ZGVhZGJlZWY',
        displayName: 'ci-runner',
        updateTime: '2022-02-10T10:53:27Z',
      },
    ])
  })

  it('cannot pass a token VALUE through even if one appeared in a response', async () => {
    // The list endpoint does not return values today. This pins the mapper as
    // an allowlist rather than a passthrough, so that a future API that DID
    // start returning one could not silently route it into this tool's output.
    const tokens = await fetchDebugTokens({
      token: 't',
      projectId: 'p',
      appId: 'app-1',
      fetchImpl: async () =>
        ok({
          debugTokens: [
            {
              name: 'projects/1/apps/app-1/debugTokens/abc',
              displayName: 'x',
              updateTime: '2022-01-01T00:00:00Z',
              token: 'SHOULD-NEVER-SURFACE',
            },
          ],
        }),
    })
    assert.deepEqual(Object.keys(tokens[0]).sort(), [
      'displayName',
      'id',
      'updateTime',
    ])
    assert.ok(!JSON.stringify(tokens).includes('SHOULD-NEVER-SURFACE'))
  })

  it('throws rather than reporting clean when the API refuses', async () => {
    await assert.rejects(
      fetchDebugTokens({
        token: 't',
        projectId: 'p',
        appId: 'app-1',
        fetchImpl: async () => ({
          ok: false,
          status: 403,
          text: async () => 'PERMISSION_DENIED',
        }),
      }),
      /debugTokens 403/,
    )
  })
})

describe('fetchApps', () => {
  it('enumerates every platform, not just web', async () => {
    const apps = await fetchApps({
      token: 't',
      projectId: 'p',
      fetchImpl: async (url) => {
        assert.equal(url, searchAppsUrl('p'))
        return ok({
          apps: [
            { appId: 'w', displayName: 'Console', platform: 'WEB' },
            { appId: 'a', platform: 'ANDROID' },
          ],
        })
      },
    })
    assert.deepEqual(apps, [
      { appId: 'w', displayName: 'Console', platform: 'WEB' },
      { appId: 'a', displayName: '(unnamed)', platform: 'ANDROID' },
    ])
  })

  it('throws rather than reporting zero apps when the API refuses', async () => {
    await assert.rejects(
      fetchApps({
        token: 't',
        projectId: 'p',
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => 'UNAUTHENTICATED',
        }),
      }),
      /searchApps 401/,
    )
  })
})

describe('formatReport', () => {
  it('names each offending token and its app', () => {
    const report = formatReport(
      summarize([
        {
          appId: 'app-1',
          displayName: 'Console',
          platform: 'WEB',
          tokens: [{ id: 'i', displayName: 'ci-runner', updateTime: '2022' }],
        },
      ]),
      { projectId: 'aglyn-main' },
    )
    assert.match(report, /ci-runner/)
    assert.match(report, /app-1/)
    assert.match(report, /Manage debug tokens/)
  })

  it('says so plainly when there is nothing registered', () => {
    const report = formatReport(summarize([{ appId: 'a', tokens: [] }]), {
      projectId: 'aglyn-main',
    })
    assert.match(report, /No App Check debug token is registered/)
  })
})

describe('requestHeaders', () => {
  it('sends the quota project for a user credential', () => {
    assert.deepEqual(requestHeaders('t', 'aglyn-main'), {
      Authorization: 'Bearer t',
      'x-goog-user-project': 'aglyn-main',
    })
  })

  it('omits it entirely for a service account', () => {
    // Not "sends undefined" — the header must be ABSENT, or the request needs
    // `serviceusage.services.use` that the deploy service account has no
    // reason to hold.
    assert.deepEqual(requestHeaders('t', undefined), {
      Authorization: 'Bearer t',
    })
  })
})

describe('urls', () => {
  it('targets the documented App Check resource', () => {
    assert.equal(
      debugTokensUrl('aglyn-main', '1:2:web:3'),
      'https://firebaseappcheck.googleapis.com/v1/projects/aglyn-main/apps/1%3A2%3Aweb%3A3/debugTokens',
    )
  })
})
