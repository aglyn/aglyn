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
 * The package import's decisions (AGL-3534), without a screen: where a
 * decision comes from, which dependencies are asked about, what a diff and
 * a merge show, and what is acknowledged before the import.
 */

import { SITE_PACKAGE_PLAN } from '../fixtures/site-package'
import {
  INITIAL_PACKAGE_BULK_DEFAULTS,
  effectivePackageDecision,
  packageAcknowledgements,
  packageDecided,
  packageDecisions,
  packageDependencyChoices,
  packageDependencyPrompts,
  packageDependencyProblems,
  packageJsonDiff,
  packageMergeKeys,
} from './site-package-import-state'

const item = (key: string) => SITE_PACKAGE_PLAN.items.find((one) => one.key === key)!

describe('decisions', () => {
  it('takes the item’s own choice, then the default for its change, then the proposal — each only when allowed', () => {
    const bulk = { ...INITIAL_PACKAGE_BULK_DEFAULTS, differs: 'keepBoth' as const }
    expect(effectivePackageDecision(item('page/home'), {}, bulk)).toBe('keepBoth')
    expect(effectivePackageDecision(item('page/home'), { 'page/home': 'replace' }, bulk)).toBe('replace')
    // A choice the item cannot take is passed over.
    expect(effectivePackageDecision(item('page/home'), { 'page/home': 'merge' }, bulk)).toBe('keepBoth')
    expect(effectivePackageDecision(item('settings/settings'), {}, bulk)).toBeNull()
    expect(effectivePackageDecision(item('layout/chrome-new'), {}, bulk)).toBe('create')
    expect(effectivePackageDecision(item('page/about'), {}, bulk)).toBe('skip')
  })

  it('names the changed items still waiting', () => {
    expect(packageDecisions(SITE_PACKAGE_PLAN, {}, INITIAL_PACKAGE_BULK_DEFAULTS).undecided).toEqual([
      'page/home',
      'settings/settings',
    ])
  })
})

describe('dependency prompts', () => {
  const decided = (overrides = {}) =>
    packageDecisions(SITE_PACKAGE_PLAN, { 'page/home': 'replace', ...overrides }, INITIAL_PACKAGE_BULK_DEFAULTS).decisions

  it('asks about what neither side holds, and about a skipped item the file carries', () => {
    expect(packageDependencyPrompts(SITE_PACKAGE_PLAN, decided()).map((one) => one.key)).toEqual(['layout/gone'])
    const prompts = packageDependencyPrompts(SITE_PACKAGE_PLAN, decided({ 'layout/chrome-new': 'skip' }))
    expect(prompts.map((one) => [one.key, one.neededBy, Boolean(one.inPackage)])).toEqual([
      ['layout/chrome-new', ['page/home'], true],
      ['layout/gone', ['page/orphan'], false],
    ])
  })

  it('asks nothing for an item that is not written', () => {
    expect(packageDependencyPrompts(SITE_PACKAGE_PLAN, decided({ 'page/orphan': 'skip' }))).toEqual([])
  })

  it('names the unanswered and unmapped prompts, and sends only complete answers', () => {
    const prompts = packageDependencyPrompts(SITE_PACKAGE_PLAN, decided())
    expect(packageDependencyProblems(prompts, {})).toEqual(['Choose what to do about 1 missing item.'])
    expect(packageDependencyProblems(prompts, { 'layout/gone': { mapTo: '' } })).toEqual([
      'Pick the item to use for 1 reference.',
    ])
    expect(packageDependencyChoices(prompts, { 'layout/gone': { mapTo: '' }, 'layout/elsewhere': 'drop' })).toEqual({})
    expect(packageDependencyChoices(prompts, { 'layout/gone': 'drop' })).toEqual({ 'layout/gone': 'drop' })
  })
})

describe('diffs', () => {
  it('lists every leaf that differs, walking objects and comparing lists whole', () => {
    const { changes, more } = packageJsonDiff(
      { a: 1, b: { c: [1, 2], d: 'x' } },
      { a: 1, b: { c: [1, 3], d: 'x', e: true } },
    )
    expect(changes.map((one) => [one.label, one.before, one.after])).toEqual([
      ['b › c', [1, 2], [1, 3]],
      ['b › e', undefined, true],
    ])
    expect(more).toBe(0)
  })

  it('stops at the limit and counts the rest', () => {
    const after = Object.fromEntries(Array.from({ length: 5 }, (_unused, n) => [`k${n}`, n]))
    expect(packageJsonDiff({}, after, 2)).toMatchObject({ more: 3 })
  })

  it('lists a merge’s differing keys, the site’s value kept where it has one', () => {
    expect(packageMergeKeys({ name: 'Old', locale: '', same: 1 }, { name: 'New', locale: 'fr', same: 1 })).toEqual([
      { key: 'locale', site: '', file: 'fr', merged: 'package' },
      { key: 'name', site: 'Old', file: 'New', merged: 'site' },
    ])
  })
})

describe('review', () => {
  it('asks to acknowledge what is written over and each reference warning, and tells what is left out', () => {
    const items = packageAcknowledgements(
      {
        warnings: [{ code: 'droppedReference', item: 'page/orphan', dependency: 'layout/gone', message: '' }],
        warningsTotal: 1,
        unknownKinds: ['booking'],
        notSent: [],
      },
      { 'page/home': 'replace', 'settings/settings': 'merge', 'page/about': 'skip' },
      (key) => key.toUpperCase(),
    )
    expect(items.map((one) => [one.id, one.count, one.required])).toEqual([
      ['overwrite', 2, true],
      ['droppedReference', 1, true],
      ['unknownKinds', 1, false],
    ])
    expect(items[1]?.samples).toEqual(['PAGE/ORPHAN → layout/gone'])
  })

  it('sends merge keys only for merged items', () => {
    expect(
      packageDecided({ 'page/home': 'replace' }, [], {}, { 'page/home': { a: 'site' }, 'settings/settings': {} }),
    ).toEqual({ decisions: { 'page/home': 'replace' }, dependencyChoices: {}, mergeChoices: {} })
  })
})
