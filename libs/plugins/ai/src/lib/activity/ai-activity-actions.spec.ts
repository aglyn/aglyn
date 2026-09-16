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
 * The AI action catalog (AGL-2929): one list the writers, the feed's label
 * map and the staff facet all read. What must hold: every code has a label,
 * the codes are the dotted `ai.*` shape the viewers key on, and the staff
 * facet files the AI-adjacent audit actions under the same group as the
 * codes.
 */

import {
  AI_ACTIVITY_ACTIONS,
  AI_ACTIVITY_ACTION_LABELS,
  AI_ACTIVITY_ACTION_LIST,
  aiActivityActionLabel,
  aiOutputTargetType,
  isAiActivityAction,
  staffAuditActionGroup,
  staffAuditActionGroupLabel,
} from './ai-activity-actions'

describe('the catalog', () => {
  it('holds the actions the issues name, each as an ai.* code', () => {
    expect(AI_ACTIVITY_ACTION_LIST).toEqual([
      'ai.job.created',
      'ai.job.output',
      'ai.job.canceled',
      'ai.job.needs_input',
      'ai.edit.applied',
      // A site audit applied as drafts (AGL-2910).
      'ai.seo.applied',
      'ai.assist.section',
      'ai.overage.hardCap',
      'ai.overage.cap',
      // A manager set or removed an allotment (AGL-2942).
      'ai.allotment.changed',
      'ai.permission.changed',
      'ai.addon.purchased',
      'ai.addon.removed',
    ])
    for (const code of AI_ACTIVITY_ACTION_LIST) expect(code).toMatch(/^ai\./)
  })

  it('labels every code, with a sentence a reader can act on rather than the code', () => {
    for (const code of Object.values(AI_ACTIVITY_ACTIONS)) {
      const label = AI_ACTIVITY_ACTION_LABELS[code]
      expect(label).toEqual(expect.any(String))
      expect(label).not.toContain('.')
      expect(aiActivityActionLabel(code)).toBe(label)
    }
  })

  it('recognizes only its own codes', () => {
    expect(isAiActivityAction('ai.job.output')).toBe(true)
    expect(isAiActivityAction('Saved the screen')).toBe(false)
    expect(isAiActivityAction('ai.something.else')).toBe(false)
    expect(isAiActivityAction(undefined)).toBe(false)
    expect(aiActivityActionLabel('Saved the screen')).toBeUndefined()
  })
})

describe('where the feed files a job output', () => {
  it('names a target both logs know for every resource kind a job can write', () => {
    expect(aiOutputTargetType('screen')).toBe('screen')
    expect(aiOutputTargetType('reusableComponent')).toBe('component')
    expect(aiOutputTargetType('layout')).toBe('layout')
    expect(aiOutputTargetType('template')).toBe('template')
    expect(aiOutputTargetType('workflow')).toBe('workflow')
    // A theme proposal is filed under the site's theme (AGL-2938), which the
    // host feed links to the Theme section.
    expect(aiOutputTargetType('theme')).toBe('theme')
    // Copy is content, and so is a search listing; so are the kinds whose
    // runners have not shipped.
    expect(aiOutputTargetType('text')).toBe('content')
    expect(aiOutputTargetType('seo')).toBe('content')
    for (const resource of ['form', 'emailScreen', 'campaign', 'product', 'experiment'] as const) {
      expect(aiOutputTargetType(resource)).toBe('content')
    }
  })
})

describe('the staff audit facet groups AI', () => {
  it('files every ai.* code, the overage controls and the free-spend pause under one group', () => {
    expect(staffAuditActionGroup('ai.overage.cap')).toBe('ai')
    expect(staffAuditActionGroup('billing.assistOverage.setHardCap')).toBe('ai')
    expect(staffAuditActionGroup('billing.assistOverage.setCap')).toBe('ai')
    expect(staffAuditActionGroup('platform.aiFreeSpend.paused')).toBe('ai')
  })

  it('files every other action under its leading namespace', () => {
    expect(staffAuditActionGroup('org.override')).toBe('org')
    expect(staffAuditActionGroup('billing.disputeOpened')).toBe('billing')
    expect(staffAuditActionGroup('plugins.artifacts.reap')).toBe('plugins')
    expect(staffAuditActionGroup('access')).toBe('access')
    expect(staffAuditActionGroup('')).toBe('')
    expect(staffAuditActionGroup(undefined)).toBe('')
  })

  it('names the AI group the way the feed chip does, and leaves the rest as written', () => {
    expect(staffAuditActionGroupLabel('ai')).toBe('AI')
    expect(staffAuditActionGroupLabel('billing')).toBe('billing')
  })
})
