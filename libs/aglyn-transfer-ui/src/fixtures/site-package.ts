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
 * A small site package for the package wizard's specs (AGL-3534): a home
 * page that differs from the site's and needs a new layout, a page already
 * on the site, a page that needs a layout neither side holds, and site
 * settings that differ — plus a fake client that answers the import and
 * export routes' shapes and records every request.
 */

import type {
  SitePackageApplyAnswer,
  SitePackageCatalog,
  SitePackageClient,
  SitePackageComparison,
  SitePackageDecisions,
  SitePackagePlan,
  SitePackagePlanAnswer,
  SitePackageUndoChoice,
  SitePackageUndoPlan,
  SitePackageWarning,
} from '../lib/site-package-client'

export const SITE_PACKAGE_FILE = { manifest: { format: 'aglyn-package', version: 2, items: [] }, items: {} }

export const SITE_PACKAGE_PLAN: SitePackagePlan = {
  items: [
    {
      key: 'page/home',
      kind: 'page',
      id: 'home',
      name: 'Home',
      slug: '',
      status: 'differs',
      comparison: 'differs',
      existing: { id: 'home', name: 'Home' },
      matchedBy: 'id',
      deps: [{ kind: 'layout', id: 'chrome-new' }],
      missing: [],
      proposed: 'skip',
      needsChoice: true,
      choices: ['replace', 'keepBoth', 'skip'],
    },
    {
      key: 'page/about',
      kind: 'page',
      id: 'about',
      name: 'About',
      slug: 'about',
      status: 'identical',
      comparison: 'identical',
      existing: { id: 'about', name: 'About', slug: 'about' },
      matchedBy: 'id',
      deps: [],
      missing: [],
      proposed: 'skip',
      needsChoice: false,
      choices: ['replace', 'keepBoth', 'skip'],
    },
    {
      key: 'page/orphan',
      kind: 'page',
      id: 'orphan',
      name: 'Orphan',
      slug: 'orphan',
      status: 'missingDependency',
      comparison: 'new',
      deps: [{ kind: 'layout', id: 'gone' }],
      missing: [{ kind: 'layout', id: 'gone' }],
      proposed: 'create',
      needsChoice: true,
      choices: ['create', 'skip'],
    },
    {
      key: 'layout/chrome-new',
      kind: 'layout',
      id: 'chrome-new',
      name: 'New chrome',
      status: 'new',
      comparison: 'new',
      deps: [],
      missing: [],
      proposed: 'create',
      needsChoice: false,
      choices: ['create', 'skip'],
    },
    {
      key: 'settings/settings',
      kind: 'settings',
      id: 'settings',
      name: 'Site settings',
      status: 'differs',
      comparison: 'differs',
      existing: { id: 'settings', name: 'Site settings' },
      matchedBy: 'id',
      deps: [],
      missing: [],
      proposed: 'skip',
      needsChoice: true,
      choices: ['replace', 'skip', 'merge'],
    },
  ],
  counts: { new: 1, identical: 1, differs: 2, missingDependency: 1 },
  kinds: [
    { kind: 'page', label: 'Pages', count: 3 },
    { kind: 'layout', label: 'Layouts', count: 1 },
    { kind: 'settings', label: 'Site settings', count: 1 },
  ],
}

export const SITE_PACKAGE_COMPARISONS: Record<string, SitePackageComparison> = {
  'page/home': {
    key: 'page/home',
    kind: 'page',
    id: 'home',
    incoming: { displayName: 'Home', version: { $id: 'v2', nodes: { text: { props: { children: 'Welcome back' } } } } },
    existing: {
      id: 'home',
      content: { displayName: 'Home', version: { $id: 'v1', nodes: { text: { props: { children: 'Welcome' } } } } },
    },
  },
  'settings/settings': {
    key: 'settings/settings',
    kind: 'settings',
    id: 'settings',
    incoming: { displayName: 'Acme Two', locale: 'fr', favicon: 'f.png' },
    existing: { id: 'settings', content: { displayName: 'Acme', locale: 'en' } },
  },
}

export const SITE_PACKAGE_CATALOG: SitePackageCatalog = {
  manifest: {
    format: 'aglyn-package',
    version: 2,
    items: [
      { kind: 'page', $id: 'home', name: 'Home', contentHash: 'sha256:a', deps: [{ kind: 'layout', id: 'site-chrome' }] },
      { kind: 'page', $id: 'about', name: 'About', slug: 'about', contentHash: 'sha256:b', deps: [] },
      { kind: 'layout', $id: 'site-chrome', name: 'Site chrome', contentHash: 'sha256:c', deps: [] },
      { kind: 'layout', $id: 'plain', name: 'Plain', contentHash: 'sha256:d', deps: [] },
    ],
  },
  kinds: [
    { kind: 'page', label: 'Pages' },
    { kind: 'layout', label: 'Layouts' },
  ],
}

export interface FakeSitePackageClient extends SitePackageClient {
  calls: {
    plan: Array<Partial<SitePackageDecisions> | undefined>
    compare: string[][]
    apply: SitePackageDecisions[]
    undo: Array<{ decisions: Record<string, SitePackageUndoChoice>; otherwise: SitePackageUndoChoice }>
    exportPackage: Array<{ items?: readonly string[]; dependencies?: boolean }>
  }
}

/** The warnings the route would answer for these decisions. */
function warningsFor(decided: Partial<SitePackageDecisions> | undefined): SitePackageWarning[] {
  const choice = decided?.dependencyChoices?.['layout/gone']
  if (!decided?.decisions || decided.decisions['page/orphan'] === 'skip') return []
  if (typeof choice === 'object') {
    return [{ code: 'mappedReference', item: 'page/orphan', dependency: 'layout/gone', message: 'mapped' }]
  }
  if (choice === 'drop') {
    return [{ code: 'droppedReference', item: 'page/orphan', dependency: 'layout/gone', message: 'dropped' }]
  }
  return [{ code: 'danglingReference', item: 'page/orphan', dependency: 'layout/gone', message: 'dangling' }]
}

export function createFakeSitePackageClient(
  options: { capRefusal?: string | null; unknownKinds?: string[] } = {},
): FakeSitePackageClient {
  const calls: FakeSitePackageClient['calls'] = { plan: [], compare: [], apply: [], undo: [], exportPackage: [] }
  const planAnswer = (decided?: Partial<SitePackageDecisions>): SitePackagePlanAnswer => {
    const warnings = warningsFor(decided)
    return {
      format: 2,
      plan: SITE_PACKAGE_PLAN,
      capRefusal: decided ? (options.capRefusal ?? null) : null,
      warnings,
      warningsTotal: warnings.length,
      unknownKinds: options.unknownKinds ?? [],
      notSent: [],
    }
  }
  return {
    calls,
    async plan(_file, decided) {
      calls.plan.push(decided)
      return planAnswer(decided)
    },
    async compare(_file, keys) {
      calls.compare.push([...keys])
      return keys.flatMap((key) => (SITE_PACKAGE_COMPARISONS[key] ? [SITE_PACKAGE_COMPARISONS[key]] : []))
    },
    async apply(_file, decided): Promise<SitePackageApplyAnswer> {
      calls.apply.push(decided)
      const counts: Record<string, number> = {}
      for (const decision of Object.values(decided.decisions)) counts[decision] = (counts[decision] ?? 0) + 1
      const warnings = warningsFor(decided)
      return { importId: 'import-1', written: 7, counts, warnings, warningsTotal: warnings.length }
    },
    async undoPlan(importId): Promise<SitePackageUndoPlan> {
      return {
        importId,
        counts: { restore: 2, delete: 2, conflict: 1 },
        conflicts: [{ key: 'page/home', kind: 'page', targetId: 'home', name: 'Home', step: 'restore' }],
      }
    },
    async undo(importId, choices) {
      calls.undo.push(choices)
      return { importId, reverted: 4, kept: 0, restoredDocuments: 3, deletedDocuments: 2 }
    },
    async catalog() {
      return SITE_PACKAGE_CATALOG
    },
    async exportPackage(selection) {
      calls.exportPackage.push(selection)
      return { fileName: 'aglyn-acme.json', body: new Blob(['{}'], { type: 'application/json' }) }
    },
  }
}
