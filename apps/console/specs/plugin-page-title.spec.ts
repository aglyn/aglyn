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
  PLUGIN_TITLES,
  pluginPageTitle,
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
