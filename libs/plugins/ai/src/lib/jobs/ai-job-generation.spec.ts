/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * What a job's review keeps of a refused answer (AGL-3078): each finding's
 * node ids or plan paths, and an outline of the parts of the answer they name
 * that shows its shape and never its copy, bounded in nodes and in bytes. The
 * steps that park a job, and the machine that stores the review, are held in
 * their own specs; this holds the review itself.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import {
  AI_JOB_REVIEW_OUTLINE_MAX_BYTES,
  AI_JOB_REVIEW_OUTLINE_MAX_DEPTH,
  AI_JOB_REVIEW_OUTLINE_MAX_NODES,
  AI_JOB_REVIEW_REFS_MAX,
  AI_JOB_REVIEW_REF_MAX_CHARS,
  aiDoctrineReview,
  aiDoctrineReviewOutline,
} from './ai-job-generation'

/** A live About page's refused practice areas, as the model wrote them: a Grid with no container holding items sized 4. */
const ANSWER = {
  tree: JSON.stringify({
    rootId: 'root',
    nodes: {
      root: { componentId: 'div', nodes: ['areas'] },
      areas: { componentId: 'section', props: { element: 'section' }, nodes: ['areas-title', 'areas-grid'] },
      'areas-title': { componentId: 'muiTypography', props: { variant: 'h1', component: 'h1', children: 'What we help with' } },
      'areas-grid': {
        componentId: 'muiGrid',
        props: { ariaLabel: 'Practice areas at Harborline Law', container: 'True', spacing: '3' },
        sx: { gap: 3 },
        nodes: ['cell-1', 'cell-2'],
      },
      'cell-1': { componentId: 'muiGrid', props: { size: '4' }, nodes: ['card-1'] },
      'cell-2': { componentId: 'muiGrid', props: { size: 'https://example.com/4' }, nodes: ['card-2'] },
      'card-1': { componentId: 'muiCard', props: { variant: 'outlined' }, nodes: ['card-1-title'] },
      'card-1-title': { componentId: 'muiTypography', props: { variant: 'h2', children: 'Estate planning' } },
      'card-2': { componentId: 'muiCard', props: { variant: 'outlined' }, nodes: ['card-2-link'] },
      'card-2-link': { componentId: 'muiButton', props: { children: 'Real estate', href: 'https://example.com/real-estate' } },
    },
  }),
}

const GRID_FINDING: AiDoctrineViolation = {
  rule: 12,
  code: 'grid-not-container',
  message: 'A Grid lays out columns only as a container.',
  nodeIds: ['areas-grid'],
}

describe('the review a refused answer leaves on its job', () => {
  it('keeps each finding’s node ids or plan paths, and outlines the nodes they name to the depth it keeps', () => {
    const review = aiDoctrineReview({
      message: 'This could not be built within the building rules.',
      violations: [
        GRID_FINDING,
        { rule: 2, code: 'plan-screen-without-layout', message: 'A screen names no layout.', paths: ['screens[0].layout'] },
        { rule: null, code: 'answer-cut-off', message: 'This section was too large to build in one pass.' },
      ],
      answer: ANSWER,
    })
    expect(review).toEqual({
      reason: 'doctrine',
      message: 'This could not be built within the building rules.',
      findings: [
        { ...GRID_FINDING },
        { rule: 2, code: 'plan-screen-without-layout', message: 'A screen names no layout.', paths: ['screens[0].layout'] },
        { rule: null, code: 'answer-cut-off', message: 'This section was too large to build in one pass.' },
      ],
      outline: [
        {
          id: 'areas-grid',
          depth: 0,
          componentId: 'muiGrid',
          props: ['ariaLabel', 'container', 'spacing'],
          sx: ['gap'],
          // A Grid's layout as the model wrote it: the switch it wrote as text, and a size that is no size.
          grid: { container: 'True', spacing: '3' },
          children: ['muiGrid', 'muiGrid'],
        },
        { id: 'cell-1', depth: 1, componentId: 'muiGrid', props: ['size'], grid: { size: '4' }, children: ['muiCard'] },
        { id: 'card-1', depth: 2, componentId: 'muiCard', props: ['variant'], children: ['muiTypography'] },
        { id: 'cell-2', depth: 1, componentId: 'muiGrid', props: ['size'], grid: { size: '<text>' }, children: ['muiCard'] },
        { id: 'card-2', depth: 2, componentId: 'muiCard', props: ['variant'], children: ['muiButton'] },
      ],
    })
    expect(AI_JOB_REVIEW_OUTLINE_MAX_DEPTH).toBe(2)
  })

  it('keeps no copy and no address, whatever the answer wrote', () => {
    const outline = JSON.stringify(aiDoctrineReviewOutline(ANSWER, [{ ...GRID_FINDING, nodeIds: ['areas', 'card-2'] }]))
    expect(outline).toContain('"card-2-link"')
    for (const copy of ['What we help with', 'Practice areas', 'Harborline', 'Estate planning', 'Real estate', 'https:', 'example.com']) {
      expect([copy, outline.includes(copy)]).toEqual([copy, false])
    }
    // An id no identifier looks like is not shown either.
    const sentence = { tree: { rootId: 'r', nodes: { 'We help families plan': { componentId: 'muiBox', nodes: [] } } } }
    const review = aiDoctrineReview({
      message: 'No.',
      violations: [{ rule: 16, code: 'empty-container', message: 'Empty.', nodeIds: ['We help families plan', 'https://example.com/x'] }],
      answer: sentence,
    })
    expect(review.findings[0].nodeIds).toEqual(['?', '?'])
    expect(review.outline).toEqual([{ id: '?', depth: 0, componentId: 'muiBox', props: [], children: [] }])
  })

  it('keeps a Grid’s layout as written and none of the words written into its layout props or its children', () => {
    // A short sentence in every layout prop whose value an outline keeps, and another in the Grid's children.
    const copy = {
      container: 'Yes we can help',
      size: 'Four areas we cover',
      offset: 'Plan for what comes next',
      direction: 'Our story',
      wrap: 'Estate planning',
      spacing: 'Plain advice and fixed fees.',
      rowSpacing: 'We help families',
      columnSpacing: 'Call us: 555-0100',
      columns: 'Twelve trusted attorneys',
    }
    const layout = { container: 'True', size: '{ xs: 12, md: 4 }', offset: '{{prop.offset}}', direction: 'Column', spacing: '1.5rem' }
    const outline = aiDoctrineReviewOutline(
      {
        tree: {
          rootId: 'row',
          nodes: {
            row: { componentId: 'muiGrid', props: { ...copy, children: 'We help families plan for what comes next.' }, nodes: ['cell'] },
            cell: { componentId: 'muiGrid', props: layout },
          },
        },
      },
      [{ ...GRID_FINDING, nodeIds: ['row'] }],
    )
    expect(outline).toEqual([
      {
        id: 'row',
        depth: 0,
        componentId: 'muiGrid',
        props: [...Object.keys(copy), 'children'],
        grid: Object.fromEntries(Object.keys(copy).map((name) => [name, '<text>'])),
        children: ['muiGrid'],
      },
      { id: 'cell', depth: 1, componentId: 'muiGrid', props: Object.keys(layout), grid: layout, children: [] },
    ])
    for (const sentence of [...Object.values(copy), 'plan for what comes next']) {
      expect([sentence, JSON.stringify(outline).includes(sentence)]).toEqual([sentence, false])
    }
  })

  it('outlines nothing for an answer that is no node map, or findings that name no node', () => {
    expect(aiDoctrineReview({ message: 'No.', violations: [GRID_FINDING], answer: { tree: '{"rootId": "root", "nod' } })).toEqual({
      reason: 'doctrine',
      message: 'No.',
      findings: [GRID_FINDING],
    })
    expect(aiDoctrineReview({ message: 'No.', violations: [GRID_FINDING] }).outline).toBeUndefined()
    expect(aiDoctrineReviewOutline(ANSWER, [{ ...GRID_FINDING, nodeIds: [] }])).toEqual([])
    expect(aiDoctrineReviewOutline({ screens: [] }, [GRID_FINDING])).toEqual([])
  })

  it('bounds what it keeps: the ids a finding names, their length, and the outline in nodes and in bytes', () => {
    const many = Array.from({ length: 60 }, (_, index) => `n${index}`)
    const long = `n${'x'.repeat(200)}`
    const review = aiDoctrineReview({
      message: 'No.',
      violations: [{ ...GRID_FINDING, nodeIds: [long, ...many] }],
      answer: {
        tree: {
          rootId: 'root',
          nodes: Object.fromEntries([long, ...many].map((id) => [id, { componentId: 'muiBox', props: { component: 'div' } }])),
        },
      },
    })
    expect(review.findings[0].nodeIds).toHaveLength(AI_JOB_REVIEW_REFS_MAX)
    expect(review.findings[0].nodeIds?.[0]).toBe(long.slice(0, AI_JOB_REVIEW_REF_MAX_CHARS))
    // The outline follows the ids a finding keeps, and stops at its node count.
    expect(review.outline).toHaveLength(Math.min(AI_JOB_REVIEW_REFS_MAX, AI_JOB_REVIEW_OUTLINE_MAX_NODES))

    const wide = Array.from({ length: 30 }, (_, index) => `grid-${index}`)
    const nodes = Object.fromEntries(
      wide.map((id) => [
        id,
        {
          componentId: 'muiGrid',
          props: Object.fromEntries(Array.from({ length: 20 }, (_, prop) => [`prop${prop}`, 'x'])),
          sx: Object.fromEntries(Array.from({ length: 20 }, (_, key) => [`key${key}`, 1])),
          nodes: wide,
        },
      ]),
    )
    const outline = aiDoctrineReviewOutline({ tree: { rootId: 'grid-0', nodes } }, [{ ...GRID_FINDING, nodeIds: wide }])
    expect(outline.length).toBeLessThan(AI_JOB_REVIEW_OUTLINE_MAX_NODES)
    expect(new TextEncoder().encode(JSON.stringify(outline)).length).toBeLessThanOrEqual(AI_JOB_REVIEW_OUTLINE_MAX_BYTES)
    expect(outline[0].props).toHaveLength(16)
    expect(outline[0].children).toHaveLength(16)
  })

  it('is described in the developer notes with the bounds the code keeps', () => {
    const notes = readFileSync(join(__dirname, '..', '..', '..', '..', '..', '..', 'docs', 'AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect(notes).toContain(
      `at most ${AI_JOB_REVIEW_REFS_MAX} node ids or plan paths a finding, each cut at ${AI_JOB_REVIEW_REF_MAX_CHARS} characters`,
    )
    expect(notes).toContain(
      `${AI_JOB_REVIEW_OUTLINE_MAX_DEPTH} levels below each node a finding names, at most ${AI_JOB_REVIEW_OUTLINE_MAX_NODES} nodes and ${AI_JOB_REVIEW_OUTLINE_MAX_BYTES.toLocaleString('en-US')} bytes as JSON`,
    )
  })
})
