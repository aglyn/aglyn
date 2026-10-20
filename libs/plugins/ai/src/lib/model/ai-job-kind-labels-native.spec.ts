// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { aiJobKindLabel } from '../components/ai-jobs-list-page.component'
import { AI_JOB_KINDS } from './ai-jobs.types'

/**
 * The native AI jobs screens name a job's kind the way the console's rows do (`aiJobKindLabel`): "Automation",
 * "Site import", "AI job" for a kind with no noun. Never the kind id title-cased ("Crm"). Both apps read the same spec.
 */
describe('native AI job kind labels', () => {
  const spec = JSON.parse(
    readFileSync(join(__dirname, '../../ios/Sources/AglynAiPlugin/Resources/ai.screens.json'), 'utf8'),
  ) as { screens: { id: string; constants?: { kindLabels?: Record<string, string> } }[] }

  it.each(['ai.jobs', 'ai.job'])('%s labels every kind as the console does', (id) => {
    const labels = spec.screens.find((screen) => screen.id === id)?.constants?.kindLabels
    expect(labels).toEqual(Object.fromEntries(AI_JOB_KINDS.map((kind) => [kind, aiJobKindLabel(kind)])))
  })

  it('never title-cases a kind id', () => {
    expect(JSON.stringify(spec)).not.toContain('item.kind:title')
  })
})
