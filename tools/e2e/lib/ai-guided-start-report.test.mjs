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

// Self-test for the local guided start's verdicts (AGL-3596): what counts as
// a build page with nothing active, a failure shown mid-run, a cut search
// title, a bound form and a linked page.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  analyzeProgress,
  boundFormIds,
  distinctSnapshots,
  linksTo,
  seoTextVerdict,
  summaryMarkdown,
} from './ai-guided-start-report.mjs'

const row = (label, state, text = label) => ({ label, state, text })
const snap = (atMs, jobStatus, rows, extra = {}) => ({
  atMs,
  jobStatus,
  heading: 'Building your site',
  rows,
  alerts: [],
  ...extra,
})

describe('distinctSnapshots', () => {
  it('keeps the first of each run of identical states', () => {
    const a = snap(0, 'running', [row('Plan', 'active')])
    const b = snap(1, 'running', [row('Plan', 'active')])
    const c = snap(2, 'running', [row('Plan', 'done')])
    assert.deepEqual(distinctSnapshots([a, b, c]), [a, c])
  })
})

describe('analyzeProgress', () => {
  it('finds a working state with no active row', () => {
    const result = analyzeProgress([
      snap(0, 'running', [
        row('Plan', 'active'),
        row('Contact form', 'waiting'),
      ]),
      snap(1, 'queued', [row('Plan', 'done'), row('Contact form', 'waiting')]),
      snap(2, 'done', [row('Plan', 'done'), row('Contact form', 'done')]),
    ])
    assert.equal(result.activeRowAlwaysWhileWorking, false)
    assert.equal(result.workingWithoutActive.length, 1)
    assert.equal(result.formRowSeen, true)
    assert.equal(result.formRowActive, false)
  })

  it('reports a stopped row or an error alert before the job settled, and not after', () => {
    const result = analyzeProgress([
      snap(0, 'running', [row('Home page', 'failed')]),
      snap(1, 'running', [row('Home page', 'active')], {
        alerts: ['Something went wrong reading it.'],
      }),
      snap(2, 'failed', [row('Home page', 'failed')]),
    ])
    assert.equal(result.troubleMidRun.length, 2)
    assert.equal(result.activeRowAlwaysWhileWorking, false)
  })

  it('passes a run that always showed what was working', () => {
    const result = analyzeProgress([
      // The page still loading the job: no rows yet, not a build state.
      snap(0, 'queued', []),
      snap(0, 'running', [row('Plan', 'active')]),
      snap(1, 'running', [row('Plan', 'done'), row('Contact form', 'active')]),
      snap(2, 'done', [row('Plan', 'done'), row('Contact form', 'done')]),
    ])
    assert.equal(result.activeRowAlwaysWhileWorking, true)
    assert.equal(result.formRowActive, true)
    assert.deepEqual(result.troubleMidRun, [])
  })
})

describe('the look row (AGL-3660)', () => {
  const look = (state, text = 'Designing your look') => ({ ...row('Designing your look', state), text })
  it('is the first row after planning, is active while it runs, and keeps its credits once done', () => {
    const result = analyzeProgress([
      snap(0, 'running', [row('Planning your pages', 'active'), look('waiting'), row('Writing page 1', 'waiting')]),
      snap(1, 'running', [row('Planning your pages', 'done'), look('active'), row('Writing page 1', 'waiting')]),
      snap(2, 'done', [row('Planning your pages', 'done'), look('done', 'Designing your look 2 credits'), row('Writing page 1', 'done')]),
    ])
    assert.equal(result.lookRowSeen, true)
    assert.equal(result.lookRowFirst, true)
    assert.equal(result.lookRowActive, true)
    assert.equal(result.lookCreditsKept, true)
  })

  it('fails a look row that loses its credits or comes after another', () => {
    const result = analyzeProgress([
      snap(0, 'running', [row('Planning your pages', 'done'), row('Header', 'active'), look('waiting')]),
      snap(1, 'done', [row('Planning your pages', 'done'), row('Header', 'done'), look('done')]),
    ])
    assert.equal(result.lookRowFirst, false)
    assert.equal(result.lookRowActive, false)
    assert.equal(result.lookCreditsKept, false)
  })
})

describe('seoTextVerdict', () => {
  it('passes a finished title within its length', () => {
    assert.deepEqual(seoTextVerdict('Hillside Dog Grooming in Austin', 60), {
      ok: true,
      reason: null,
    })
  })

  it('refuses an empty, long, ellipsized or dangling one', () => {
    assert.equal(seoTextVerdict('', 60).ok, false)
    assert.equal(seoTextVerdict('x'.repeat(61), 60).ok, false)
    assert.equal(seoTextVerdict('Grooming for dogs…', 60).ok, false)
    assert.equal(
      seoTextVerdict('Grooming for dogs and', 60).reason,
      'ends on "and"',
    )
  })
})

describe('boundFormIds', () => {
  it('finds every formId in a node tree, however deep', () => {
    const tree = {
      nodes: {
        a: { props: { formId: 'f1' } },
        b: { children: [{ props: { formId: 'f2' } }] },
      },
    }
    assert.deepEqual(boundFormIds([tree, { props: { formId: 'f1' } }]), [
      'f1',
      'f2',
    ])
  })
})

describe('linksTo', () => {
  it('finds a link to a page path in either form', () => {
    assert.equal(
      linksTo({ nodes: { nav: { props: { href: '/contact' } } } }, '/contact'),
      true,
    )
    assert.equal(linksTo({ items: ['contact'] }, '/contact'), true)
    assert.equal(linksTo({ items: ['/about'] }, '/contact'), false)
  })
})

describe('summaryMarkdown', () => {
  it('names each check and each item failure', () => {
    const text = summaryMarkdown({
      startedAt: 'now',
      appRoot: '/repo',
      answers: { siteType: 'x' },
      runs: [
        {
          verdict: '1 FAILED',
          checks: { 'site published': { ok: false, detail: 'no sitePublish' } },
          items: [{ label: 'Home', status: 'failed', failure: 'rule 12' }],
        },
      ],
    })
    assert.match(text, /FAIL site published — no sitePublish/)
    assert.match(text, /\| Home \| failed \| 0 \| 0 \| rule 12 \|/)
  })
})
