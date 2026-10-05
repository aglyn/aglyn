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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import { PLUGIN_SITEMAP_READERS_DECLARED } from './first-party-plugins.generated'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * Child sitemaps a plugin's READER lists, for pages no query over one site
 * collection can describe (AGL-3475).
 *
 * `plugin-sitemap-sections` covers a plugin whose pages are the documents of
 * one collection under the site, addressed by one fixed path: a product per
 * row of `products`, at `/products/{slug}`. A record page is neither. Its rows
 * live in the ORGANIZATION's datasets, its address is a base the site chose,
 * and a site can have several record templates — each its own set of pages at
 * its own base. So the plugin answers in code, the way it answers a repeat's
 * rows (`repeat-rows.ts`): it names a section family here, and its reader says
 * which children the family has on a site and what each one lists.
 *
 * ## The family and its children
 *
 * A declaration names a section, `records`. Its reader answers with KEYS, and
 * each key is one child sitemap, `/sitemaps/records-{key}/{page}.xml` — one per
 * record template, say. That is how a content collection's sitemap has always
 * been addressed (`content-{slug}`), and for the same reason: the index counts
 * each child once and the child pages through its own URLs, so one template
 * with ten thousand records never shifts the page numbers of another.
 *
 * ## Declared, then registered — and an absent reader is NOT "no pages"
 *
 * A search engine reads a section missing from the index as pages that no
 * longer exist, so a reader a process forgot to register must not answer
 * "nothing". The plugin declares the family in `plugins.config.json`
 * (`sitemapReaders`), the generator compiles it, and the reader registers from
 * the plugin's `serverDeclarations`, which every process runs at boot. A
 * declared family with no reader runs the app's declarations step once more
 * and then THROWS ({@link PluginSitemapReaderUnavailableError}); the sitemap
 * route reads a throw as a degraded answer and keeps the cached one rather
 * than shipping a smaller index.
 *
 * Reached by its own subpath, never the barrel: only the tenant's sitemap and
 * `llms.txt` ask.
 */

/** The compiled declaration of one section family. */
export interface PluginSitemapReaderDeclaration {
  /** The family's name: its children are `{section}-{key}`. */
  section: string
}

/** A declaration with the plugin that made it. */
export type ResolvedPluginSitemapReaderDeclaration = PluginSitemapReaderDeclaration & {
  pluginId: string
}

/** One child a reader lists on a site. */
export interface PluginSitemapChild {
  /** The child's key: lowercase letters and digits joined by hyphens. */
  key: string
  /**
   * How many URLs the child lists — at most, since a row with no address is
   * left out of the page that would have held it. Sizes the index.
   */
  urls: number
}

/** One URL a child lists. */
export interface PluginSitemapUrl {
  /** The page's site path: `/services/roofing`. */
  path: string
  /** When the page last changed: anything `sitemapLastmod` reads. */
  lastmod?: unknown
}

/** A group of pages worth naming in `/llms.txt`. */
export interface PluginSitemapListing {
  /** What the pages are: "Services". */
  name: string
  /** The path the pages share, without slashes at either end: `services`. */
  base: string
  /** How many pages the group holds. */
  count: number
}

/** What a reader answers, for one site at a time. */
export interface PluginSitemapReader {
  /** The children this site has, in the order the index lists them. */
  children(request: { hostId: string }): Promise<PluginSitemapChild[]>
  /** One page of one child's URLs. */
  urls(request: {
    hostId: string
    key: string
    page: number
    perPage: number
  }): Promise<PluginSitemapUrl[]>
  /** The groups `/llms.txt` names. Optional: a family need not have any. */
  listings?(request: { hostId: string }): Promise<PluginSitemapListing[]>
}

/** Every declared family, in config order — the order the index lists them. */
export function listPluginSitemapReaders(): readonly ResolvedPluginSitemapReaderDeclaration[] {
  return PLUGIN_SITEMAP_READERS_DECLARED
}

/** A child's section name: `records-services`. */
export function pluginSitemapChildSection(section: string, key: string): string {
  return `${section}-${key}`
}

/**
 * A child key a section name can carry: lowercase letters and digits, joined
 * by runs of hyphens — a run of two is how a reader spells a path separator
 * (`services--residential`).
 */
const CHILD_KEY = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/

/** Whether a reader's key can name a child section. */
export function isPluginSitemapChildKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= 120 && CHILD_KEY.test(key)
}

/**
 * The declared family and child key a section name addresses, or `null`. The
 * longest family wins, so `records-x` never reads as a child of a family
 * named `rec`.
 */
export function parsePluginSitemapChildSection(
  section: string,
  declared: readonly ResolvedPluginSitemapReaderDeclaration[] = PLUGIN_SITEMAP_READERS_DECLARED,
): { declaration: ResolvedPluginSitemapReaderDeclaration; key: string } | null {
  const matches = declared
    .filter((one) => section.startsWith(`${one.section}-`))
    .sort((a, b) => b.section.length - a.section.length)
  const declaration = matches[0]
  if (!declaration) return null
  const key = section.slice(declaration.section.length + 1)
  return isPluginSitemapChildKey(key) ? { declaration, key } : null
}

interface RegisteredReader {
  pluginId: string
  reader: PluginSitemapReader
}

/**
 * One table per process, on `globalThis` (AGL-3412): readers register from
 * `instrumentation.ts`, which Next compiles apart from the routes that read.
 */
const READERS_KEY = Symbol.for('@aglyn/aglyn:plugin-sitemap-readers')

const globalScope = globalThis as typeof globalThis & {
  [READERS_KEY]?: Map<string, RegisteredReader>
}

const readers: Map<string, RegisteredReader> =
  globalScope[READERS_KEY] ?? (globalScope[READERS_KEY] = new Map())

/**
 * Registers the reader for a declared family. The owner is the plugin whose
 * register fn is running, or the `pluginId` passed for a boot declaration;
 * with neither, or with a plugin other than the one the declaration names,
 * the registration throws. The same plugin registering again replaces its
 * reader. Returns the unregister.
 */
export function registerPluginSitemapReader(
  section: string,
  reader: PluginSitemapReader,
  options?: { pluginId?: string },
): () => void {
  const name = section.trim()
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!name) throw new Error('a sitemap reader needs a section')
  if (!pluginId) {
    throw new Error(
      `sitemap reader "${name}" registered with no owner: pass { pluginId } ` +
        'when registering outside a plugin register fn',
    )
  }
  const declared = PLUGIN_SITEMAP_READERS_DECLARED.find((one) => one.section === name)
  if (declared && declared.pluginId !== pluginId) {
    throw new Error(
      `sitemap section "${name}" is declared by "${declared.pluginId}"; ` +
        `refused a reader from "${pluginId}"`,
    )
  }
  const entry: RegisteredReader = { pluginId, reader }
  readers.set(name, entry)
  return () => {
    if (readers.get(name) === entry) readers.delete(name)
  }
}

/** Only for specs: forgets every registered reader. */
export function resetPluginSitemapReadersForTests(): void {
  readers.clear()
}

/**
 * A declared family's reader was not registered, even after the app's
 * declarations step ran again. Thrown, never answered as "no pages".
 */
export class PluginSitemapReaderUnavailableError extends Error {
  constructor(readonly declaration: ResolvedPluginSitemapReaderDeclaration) {
    super(
      `sitemap section "${declaration.section}" is declared by ` +
        `"${declaration.pluginId}" but no reader is registered in this process ` +
        '— its server declarations did not run.',
    )
    this.name = 'PluginSitemapReaderUnavailableError'
  }
}

/**
 * The reader a declared family answers through — after one repair when it is
 * missing, and a throw when it is still missing.
 */
export async function pluginSitemapReader(
  declaration: ResolvedPluginSitemapReaderDeclaration,
): Promise<PluginSitemapReader> {
  let registered = readers.get(declaration.section)
  if (!registered) {
    try {
      await runPluginDeclarationsRepair()
    } catch (error) {
      console.error('[sitemap-readers] the declarations repair failed', error)
    }
    registered = readers.get(declaration.section)
  }
  if (!registered) throw new PluginSitemapReaderUnavailableError(declaration)
  return registered.reader
}
