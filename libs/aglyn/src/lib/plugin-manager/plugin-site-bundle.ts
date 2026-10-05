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
import { PLUGIN_SITE_BUNDLE_SECTIONS_DECLARED } from './first-party-plugins.generated'
import { runPluginDeclarationsRepair } from './plugin-declarations-repair'

/**
 * A plugin's SECTION of the whole-site backup (AGL-3080): what it carries in
 * the bundle and restores from it, when a host collection's `siteExport`
 * cannot say so.
 *
 * A plain host collection is copied by the export and restore routes
 * themselves (`plugin-site-export.ts`). Some plugin data is not that shape:
 * it lives under the ORGANIZATION and is narrowed to the site being backed up,
 * it carries a subcollection, a restore has to validate it against its own
 * model and derive what the model implies, and its count is sold as an add-on
 * rather than read off the plan. Only the plugin knows any of that. So the
 * plugin declares the section and answers for it: the export asks it for the
 * site's share, and the restore asks it — before the first write — whether
 * the bundle would cross what the organization has paid for, then hands it the
 * bundle's items and the restore's writer.
 *
 * ## Declared, then registered — and an absent section is refused
 *
 * The plugin declares the section in `plugins.config.json`
 * (`siteBundleSections`: the bundle key and the most items it carries), which
 * the generator compiles, and registers the answer from its
 * `serverDeclarations` entry. A backup that silently lacks a section is worse
 * than a failed one — the file looks whole until the day it is restored — so
 * a section declared and not registered is not read as "nothing to carry":
 * {@link resolveSiteBundleSections} runs the app's declarations step again,
 * and throws if the section is still missing, which fails the export or the
 * restore out loud.
 *
 * ## What the restore owns
 *
 * The section writes through {@link SiteBundleImportRequest.write}, never
 * with a writer of its own: the restore's chunked batches, its document count
 * and its all-or-nothing refusal are the restore's, and a write that went
 * around them would land after a refusal or be missing from the total. The
 * restore's own stamps (`createdAt`, `updatedAt`) come from
 * {@link SiteBundleImportRequest.stamps}, so a restored document is dated the
 * way every other one is.
 *
 * Reached by its own subpath, never the barrel: its readers are the two
 * console routes and the plugins that answer them.
 */

/** A section as declared: its key in the bundle and the most items it carries. */
export interface PluginSiteBundleSectionDeclaration {
  /** The bundle's top-level key for this section's items, e.g. `datasets`. */
  key: string
  /** The most items one bundle carries; a restore reads no more. */
  limit: number
  /**
   * What a site package calls each item (AGL-3533): its kind, the plural
   * label the import screen groups them under, and the field an item with a
   * new id is matched by. Its references are the plugin's to name, through
   * the section's registered {@link PluginSiteBundleSection.package} hooks.
   */
  package: {
    kind: string
    label: string
    nameField?: string
    slugField?: string
    /** Node props that place one of its items in a design, as a host collection's declare them. */
    placements?: ReadonlyArray<{ componentId?: string; prop: string }>
  }
}

/** A declaration with the plugin that made it. */
export type ResolvedPluginSiteBundleSectionDeclaration =
  PluginSiteBundleSectionDeclaration & { pluginId: string }

/** One item of a section, as the bundle carries it: a document with its `$id`. */
export type SiteBundleItem = Record<string, any>

/** Whose backup this is. */
export interface SiteBundleRequest {
  hostId: string
  /**
   * The site's organization, or `null` for a site with none — which holds no
   * organization data, a known-empty answer rather than a failure.
   */
  orgId: string | null
  /** The section's declared limit: the most items one bundle carries. */
  limit: number
}

/** The restore's question: this bundle's items, for this site. */
export interface SiteBundleRestoreRequest extends SiteBundleRequest {
  /** The organization's document, for the plan and add-ons a count is met against. */
  org: unknown
  /** The bundle's items under the section's key, already capped at its declared limit. */
  items: readonly SiteBundleItem[]
}

/** What the restore hands a section to write with. */
export interface SiteBundleImportRequest extends SiteBundleRestoreRequest {
  /**
   * Writes one document, whole (`merge: false`), by its full path
   * (`orgs/{orgId}/…`), on the restore's batches and counted in its total.
   */
  write(documentPath: string, data: Record<string, unknown>): Promise<void>
  /** The restore's own stamps for a document it writes: its creation and update times. */
  stamps(): Record<string, unknown>
  /**
   * Loads every plugin's console server surface, for a section that checks
   * what it restores against something other plugins register there (a
   * custom field type). Costs a load, so a section asks only when it needs to.
   */
  loadPluginSurfaces(): Promise<void>
}

/** A row the restore reports without refusing: a document restored as it was, and why it is worth a look. */
export type SiteBundleReportRow = Record<string, unknown>

/** An item another item names: its package kind and id. */
export interface SiteBundleItemReference {
  kind: string
  id: string
}

/**
 * A section's answers about its items as package items (AGL-3533): what each
 * one refers to — another of its own items, a page, a media file — and the
 * item with those references moved to new ids, for an item kept beside an
 * existing one or mapped onto one the site already holds.
 */
export interface PluginSiteBundleSectionPackage {
  /** The site items this item names, by package kind and id. */
  dependencies(item: SiteBundleItem): SiteBundleItemReference[]
  /**
   * The item with every reference in `idMap` moved: `idMap` maps an item key
   * (`<kind>/<id>`) to the id it now has, or to `null` when the reference is
   * dropped. The item's own `$id` is the restore's to set, not this hook's.
   */
  remapIds(item: SiteBundleItem, idMap: ReadonlyMap<string, string | null>): SiteBundleItem
}

/** A plugin's answers for one section. */
export interface PluginSiteBundleSection {
  /** Its items as package items; required, since every section declares a package kind. */
  package: PluginSiteBundleSectionPackage
  /** The site's share, read whole or not at all: throw rather than return a short list. */
  export(request: SiteBundleRequest): Promise<SiteBundleItem[]>
  /**
   * Before the restore writes anything: the sentence it answers 403 with when
   * restoring these items would cross what the organization may hold, or
   * `null`. A bundle refused here writes nothing at all.
   */
  refusal?(request: SiteBundleRestoreRequest): Promise<string | null>
  /** Writes the items back through `request.write`; answers the rows worth reporting. */
  import(request: SiteBundleImportRequest): Promise<readonly SiteBundleReportRow[]>
}

interface Registered {
  pluginId: string
  section: PluginSiteBundleSection
}

/**
 * One table per process, on `globalThis` (AGL-3412): a plugin registers from
 * its declarations at boot, which Next compiles apart from the routes that
 * read, and a module-scoped map would be filled in one copy and read empty in
 * the other.
 */
const SECTIONS_KEY = Symbol.for('@aglyn/aglyn:site-bundle-sections')

const globalScope = globalThis as typeof globalThis & {
  [SECTIONS_KEY]?: Map<string, Registered>
}

const sections: Map<string, Registered> =
  globalScope[SECTIONS_KEY] ?? (globalScope[SECTIONS_KEY] = new Map())

/** Every declared section, in config order — the order the bundle carries them. */
export function listDeclaredSiteBundleSections(): readonly ResolvedPluginSiteBundleSectionDeclaration[] {
  return PLUGIN_SITE_BUNDLE_SECTIONS_DECLARED
}

/**
 * Registers a plugin's answers for a section it declared. The owner is the
 * plugin whose register fn is running, or the `pluginId` passed from a boot
 * declaration. Refused: no owner, a key nobody declared (only a declared
 * section is ever read, so an undeclared one would be carried by nothing),
 * and a key another plugin declared. The same plugin registering again
 * replaces its answers.
 */
export function registerPluginSiteBundleSection(
  key: string,
  section: PluginSiteBundleSection,
  options?: { pluginId?: string },
): void {
  const name = key.trim()
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      `site bundle section "${name}" registered with no owner: pass { pluginId } ` +
        'when registering outside a plugin register fn',
    )
  }
  const declared = listDeclaredSiteBundleSections().find((one) => one.key === name)
  if (!declared) {
    throw new Error(
      `site bundle section "${name}" is not declared in plugins.config.json ` +
        '(siteBundleSections), so no export would ever carry it',
    )
  }
  if (declared.pluginId !== pluginId) {
    throw new Error(
      `site bundle section "${name}" is declared by "${declared.pluginId}"; ` +
        `refused "${pluginId}"`,
    )
  }
  if (
    typeof section.package?.dependencies !== 'function' ||
    typeof section.package?.remapIds !== 'function'
  ) {
    throw new Error(
      `site bundle section "${name}" declares package kind "${declared.package.kind}" ` +
        'and registers no package hooks (dependencies, remapIds), so a package ' +
        'could neither list what its items need nor keep a copy beside an existing one',
    )
  }
  sections.set(name, { pluginId, section })
}

/** A declared section with the answers its plugin registered. */
export type ResolvedSiteBundleSection = ResolvedPluginSiteBundleSectionDeclaration & {
  section: PluginSiteBundleSection
}

/**
 * Every declared section with its answers, in config order. A declared
 * section with nothing registered runs the app's declarations step once and
 * asks again; still missing, this THROWS naming it — an export that carried
 * the rest would be a backup missing a section with nothing to say so.
 */
export async function resolveSiteBundleSections(): Promise<ResolvedSiteBundleSection[]> {
  const missing = () =>
    listDeclaredSiteBundleSections().filter((declared) => !sections.has(declared.key))
  if (missing().length) await runPluginDeclarationsRepair()
  const absent = missing()
  if (absent.length) {
    throw new Error(
      `[plugins] site bundle section(s) ${absent.map((one) => `"${one.key}" (${one.pluginId})`).join(', ')} ` +
        'declared and not registered in this process',
    )
  }
  return listDeclaredSiteBundleSections().map((declared) => ({
    ...declared,
    section: (sections.get(declared.key) as Registered).section,
  }))
}

/** Only for specs: forgets every registered section. */
export function resetSiteBundleSectionsForTests(): void {
  sections.clear()
}
