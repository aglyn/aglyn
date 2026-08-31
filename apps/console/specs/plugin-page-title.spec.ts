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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  PLUGIN_SECTION_TITLES,
  PLUGIN_SECTIONS,
  PLUGIN_TITLES,
  pluginPageTitle,
  pluginSectionTitle,
  titleCaseSlug,
} from '../app/plugin-page-title'

const PLUGINS_DIR = join(__dirname, '../../../libs/plugins')

/**
 * Every console nav item declared by a plugin, read from SOURCE.
 *
 * Not from the runtime registry: `listConsoleExtensions()` is populated by
 * `registerConsoleExtension` at plugin module load, and nothing in a jest
 * context imports those modules — it returns an empty array, which would make
 * every assertion below vacuously true. Measured: the first draft of this
 * suite discovered 0 pages and passed three of its four tests.
 *
 * Scanning source also matches what the layout can actually do. The layout is
 * a SERVER component and importing the registry there fails the build (six
 * Turbopack errors), which is why the table exists at all.
 */
function declaredNavPages(): Array<{ slug: string; label: string; file: string }> {
  const found: Array<{ slug: string; label: string; file: string }> = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry)
      if (statSync(abs).isDirectory()) {
        if (entry !== 'node_modules') walk(abs)
        continue
      }
      if (entry !== 'plugin.ts') continue
      const source = readFileSync(abs, 'utf8')
      // `label: 'X',` followed within a few lines by `href: '/slug',` — the
      // shape every registerConsoleExtension navItem uses.
      for (const match of source.matchAll(
        /label:\s*'([^']+)',[\s\S]{0,200}?href:\s*'\/([a-z0-9-]+)'/g,
      )) {
        found.push({ label: match[1], slug: match[2], file: entry })
      }
    }
  }
  walk(PLUGINS_DIR)
  return found
}

describe('plugin page titles match the nav labels (AGL-2184)', () => {
  const pages = declaredNavPages()

  it('discovers the plugin nav items rather than trusting a list', () => {
    // A walk that matched nothing passes everything below forever.
    expect(pages.length).toBeGreaterThan(4)
    expect(pages.map((page) => page.slug)).toContain('products')
    expect(pages.map((page) => page.slug)).toContain('pos')
  })

  it('titles every plugin page the way its nav item names it', () => {
    const wrong = pages
      .filter((page) => pluginPageTitle(page.slug) !== page.label)
      .map(
        (page) =>
          `${page.slug}: tab "${pluginPageTitle(page.slug)}" vs nav "${page.label}"`,
      )
      .sort()

    // Fix by adding the slug to PLUGIN_TITLES in app/plugin-page-title.ts —
    // NOT by renaming the nav item. The nav label is what a human reads in
    // the console; the tab has to follow it.
    expect(wrong).toEqual([])
  })

  it('keeps the exception table honest — every entry is still needed', () => {
    // A stale exception silently widens what is allowed.
    const unnecessary = Object.keys(PLUGIN_TITLES).filter(
      (slug) => titleCaseSlug(slug) === PLUGIN_TITLES[slug],
    )
    expect(unnecessary).toEqual([])
  })

  it('Title Cases a multi-word slug, and cannot recover an acronym', () => {
    expect(titleCaseSlug('email-campaigns')).toBe('Email Campaigns')
    expect(titleCaseSlug('pos')).toBe('Pos')
    expect(pluginPageTitle('pos')).toBe('POS')
  })
})

/**
 * Every section a plugin declares, paired with the surface slug it hangs
 * under, read from SOURCE for the reason above: the registry is empty in a
 * jest context, and the layout could not consult it anyway.
 *
 * Two files per surface. `plugin.ts` names the section list on the nav item
 * that carries the href; the `*-console-sections.ts` beside it defines the
 * list. Following the const name from one to the other is what keeps this
 * from being a third copy of the section ids.
 */
function declaredSections(): Array<{
  surface: string
  id: string
  label: string
}> {
  const sectionLists = new Map<string, Array<{ id: string; label: string }>>()
  const navItems: Array<{ surface: string; constName: string }> = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry)
      if (statSync(abs).isDirectory()) {
        if (entry !== 'node_modules') walk(abs)
        continue
      }
      if (entry.endsWith('-console-sections.ts')) {
        const source = readFileSync(abs, 'utf8')
        for (const list of source.matchAll(
          /export const ([A-Z_]+)[^=]*=\s*\[([\s\S]*?)\n\]/g,
        )) {
          sectionLists.set(
            list[1],
            [...list[2].matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map(
              (section) => ({ id: section[1], label: section[2] }),
            ),
          )
        }
        continue
      }
      if (entry !== 'plugin.ts') continue
      const source = readFileSync(abs, 'utf8')
      for (const match of source.matchAll(
        /href:\s*'\/([a-z0-9-]+)',[\s\S]{0,600}?sections:\s*([A-Z_]+)/g,
      )) {
        navItems.push({ surface: match[1], constName: match[2] })
      }
    }
  }
  walk(PLUGINS_DIR)

  return navItems.flatMap(({ surface, constName }) =>
    (sectionLists.get(constName) ?? []).map((section) => ({
      surface,
      ...section,
    })),
  )
}

describe('plugin section titles match the rail labels', () => {
  const sections = declaredSections()

  it('discovers the declared sections rather than trusting a list', () => {
    // A walk that matched nothing passes everything below forever. Both
    // halves of the join have to have worked: a surface slug from `plugin.ts`
    // and labels from the sections file it names.
    expect(sections.length).toBeGreaterThan(10)
    expect(sections).toContainEqual({
      surface: 'marketing',
      id: 'experiments',
      label: 'A/B testing',
    })
    expect(sections.map((section) => section.surface)).toContain('products')
  })

  it('titles every section the way its rail names it', () => {
    const wrong = sections
      .filter(
        (section) =>
          pluginSectionTitle(section.surface, section.id) !== section.label,
      )
      .map(
        (section) =>
          `${section.surface}/${section.id}: tab ` +
          `"${pluginSectionTitle(section.surface, section.id)}" vs rail ` +
          `"${section.label}"`,
      )
      .sort()

    // Fix by adding the section to PLUGIN_SECTIONS — and, when Title Case
    // cannot produce the label, to PLUGIN_SECTION_TITLES — in
    // app/plugin-page-title.ts. Never by renaming the rail: that is what a
    // human reads in the console, and the tab follows it.
    expect(wrong).toEqual([])
  })

  it('keeps the section table free of entries nothing declares', () => {
    const declared = new Set(
      sections.map((section) => `${section.surface}/${section.id}`),
    )
    const stale = Object.entries(PLUGIN_SECTIONS)
      .flatMap(([surface, ids]) => ids.map((id) => `${surface}/${id}`))
      .filter((key) => !declared.has(key))
      .sort()
    // A stale id makes the layout treat a document id as a section and put a
    // retired section's name in the tab.
    expect(stale).toEqual([])
  })

  it('keeps the label exceptions honest — every entry is still needed', () => {
    const unnecessary = Object.entries(PLUGIN_SECTION_TITLES).filter(
      ([key, label]) => titleCaseSlug(key.split('/')[1]) === label,
    )
    expect(unnecessary).toEqual([])
  })

  it('names nothing for a segment that is not a declared section', () => {
    // The segment beneath a surface that owns its subtree is a document id.
    // An id has no display name, and Title Casing one produces a string that
    // is no longer the id.
    expect(pluginSectionTitle('forms', 'aL_o499p_p')).toBe('')
    expect(pluginSectionTitle('marketing', 'not-a-section')).toBe('')
    expect(pluginSectionTitle('marketing', 'campaigns')).toBe('Campaigns')
  })
})
