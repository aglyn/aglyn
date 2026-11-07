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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  pluginConnectionRecordVariables,
  validatePluginImageHosts,
  type PluginConnectionDeclaration,
  type PluginConnectionRecordField,
} from '@aglyn/aglyn/app-utils/plugin-connections'
import {
  PLUGIN_CONNECTION_RECORDS_PROP,
  type PluginConnectionRecordsPageData,
  type PluginConnectionRecordValue,
  type PluginConnectionSiteRecord,
} from '@aglyn/aglyn/app-utils/plugin-connection-records'
import {
  parsePluginConnectionRepeat,
  pluginConnectionFieldTypes,
  pluginConnectionRepeatRows,
  type PluginConnectionFieldTypes,
} from '@aglyn/aglyn/app-utils/plugin-connection-repeat'
import type { HostVariable } from '@aglyn/aglyn/app-utils/variables'
import type { RepeatRowReader, RepeatRowsAnswer } from '@aglyn/aglyn/plugin-manager/repeat-rows'
import type { VariableComputation, VariableComputer } from '@aglyn/aglyn/plugin-manager/computed-variables'
import type { PluginSiteCspSource } from '@aglyn/aglyn/plugin-manager/plugin-site-csp'
import type { RealmPluginInstall } from '@aglyn/aglyn/plugin-manager/realm-plugins'
import type { SitePageContext, SitePageEnricher } from '@aglyn/aglyn/plugin-manager/site-page-hooks'
import { PLUGIN_CONNECTIONS_FEATURE, pluginConnectionRecordDocId } from '../../model/plugin-connections'
import { connectionsCollection } from './connection-store'
import { installedConnectionsForHost } from './installed-connection'

/*
 * WHAT A SITE SHOWS OF ITS PLUGINS' DECLARED CONNECTIONS (AGL-4195).
 *
 * The sync (AGL-4194) writes, per site, the record each connection's
 * declaration maps (`hosts/{hostId}/pluginConnections/record-…`). That
 * collection is server-only, so the published page reads it here, in three
 * places, all on the server:
 *
 *   - the PAGE ENRICHER hands each signed element on the page its own
 *     listing's records, as one page prop, so the element renders in the
 *     page's HTML (`usePluginConnectionRecord` in core looks it up);
 *   - the VARIABLE COMPUTER turns each record's declared summary fields into
 *     site variables a page binds as `{{var:…}}`;
 *   - the CSP SOURCE names the image hosts the site's signed plugins declare
 *     (`capabilities.imageHosts`), so the tenant admits them to `img-src` on
 *     the sites that run those plugins and nowhere else.
 *
 * A record is exposed only while the plugin is still installed at a version
 * that declares the connection (not revoked), and only on a plan with the
 * connections feature. What is exposed is held to the declaration again:
 * the record's keys are filtered to the declared ones, so a record written
 * under an older version's schema cannot show a field the pinned version no
 * longer declares.
 */

/** Records read for one site at most: four connections a plugin, a page of plugins. */
export const SITE_CONNECTION_RECORDS_READ = 40

/** One connection's record on a site, as the page and the variables read it. */
export interface SiteConnectionRecordEntry {
  listingId: string
  connectionId: string
  record: PluginConnectionSiteRecord
  variables: Record<string, HostVariable>
  /**
   * The declared type of each field (AGL-4212): which fields a repeat over
   * the record prints, and which of them are dates. The render cache's key
   * moved with it (`site-records-platform.ts`), so no cached entry lacks it;
   * optional only for the readers that never repeat.
   */
  types?: PluginConnectionFieldTypes
}

/** What reading a site's records needs: the store and the site's workspace. */
export interface SiteConnectionRecordsReadDeps {
  firestore: FirebaseFirestore.Firestore
  /** The site's workspace and its document, or `null` for an unindexed site. */
  orgForHost(hostId: string): Promise<{ orgId: string; org: Record<string, unknown> } | null>
}

const isPrimitive = (value: unknown): value is PluginConnectionRecordValue =>
  value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

/** `source` held to the declared keys: anything else, or a non-primitive, is dropped. */
function declaredOnly(
  source: unknown,
  declared: Readonly<Record<string, PluginConnectionRecordField>>,
): Record<string, PluginConnectionRecordValue> {
  const out: Record<string, PluginConnectionRecordValue> = {}
  if (!source || typeof source !== 'object' || Array.isArray(source)) return out
  for (const key of Object.keys(declared)) {
    const value = (source as Record<string, unknown>)[key]
    if (value !== undefined && isPrimitive(value)) out[key] = value
  }
  return out
}

/** A stored record, held to what `connection` declares, or `null` when it is not one. */
export function toSiteRecord(
  data: Record<string, unknown> | undefined,
  connection: PluginConnectionDeclaration,
): PluginConnectionSiteRecord | null {
  const schema = connection.sync?.record
  if (!data || data['kind'] !== 'record' || !schema) return null
  const syncedAtMs = Number(data['syncedAtMs'])
  const items = Array.isArray(data['items']) ? data['items'] : []
  const itemFields = schema.items?.fields ?? {}
  return {
    fields: declaredOnly(data['fields'], schema.fields ?? {}),
    items: schema.items ? items.slice(0, schema.items.maxItems).map((item) => declaredOnly(item, itemFields)) : [],
    syncedAtMs: Number.isFinite(syncedAtMs) ? syncedAtMs : 0,
  }
}

/**
 * Every record the site's installed plugins may show, read uncached.
 *
 * One query when the site has none — the case for nearly every site — and
 * the install pins and the workspace only when it has some.
 */
export async function readSiteConnectionRecords(
  deps: SiteConnectionRecordsReadDeps,
  hostId: string,
): Promise<SiteConnectionRecordEntry[]> {
  const snapshot = await connectionsCollection(deps.firestore, hostId)
    .where('kind', '==', 'record')
    .limit(SITE_CONNECTION_RECORDS_READ)
    .get()
  if (snapshot.empty) return []
  const owner = await deps.orgForHost(hostId)
  // A site with no workspace has no plan to hold the feature (`checkEntitlement`
  // fails open on a missing org, which is right for a page and wrong here).
  if (!owner || !checkEntitlement(owner.org as never, PLUGIN_CONNECTIONS_FEATURE)) return []
  const installed = await installedConnectionsForHost(deps.firestore, { hostId, orgId: owner.orgId })
  const out: SiteConnectionRecordEntry[] = []
  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>
    const listingId = String(data['listingId'] ?? '')
    const connectionId = String(data['connectionId'] ?? '')
    // The id is the contract (`record-{listingId}__{connectionId}`); a record
    // whose body names another connection than its id is not trusted.
    if (!listingId || !connectionId || doc.id !== pluginConnectionRecordDocId(listingId, connectionId)) continue
    const connection = installed
      .find((plugin) => plugin.listingId === listingId)
      ?.connections.find((declared) => declared.id === connectionId)
    if (!connection) continue
    const record = toSiteRecord(data, connection)
    if (!record) continue
    out.push({
      listingId,
      connectionId,
      record,
      variables: pluginConnectionRecordVariables(listingId, connection, record.fields),
      types: pluginConnectionFieldTypes(connection),
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The page enricher                                                    */
/* ------------------------------------------------------------------ */

export interface ConnectionRecordsEnricherDeps {
  /** The site's signed (realm) installs, as the page loader reads them. */
  realmInstalls(hostId: string): Promise<readonly RealmPluginInstall[]>
  /** The site's records ({@link readSiteConnectionRecords}, cached). */
  records(hostId: string): Promise<readonly SiteConnectionRecordEntry[]>
}

type PageNode = { $id?: unknown; componentId?: unknown } | null | undefined

/**
 * Node id → listing id, for every element on the page in a signed install's
 * namespace (`<identity>.<role>`). A node is attributed to the install whose
 * identity is the LONGEST prefix of its component id, so one identity being a
 * prefix of another (`acme.reviews` and `acme.reviews.pro`) cannot hand an
 * element the other's records.
 */
export function signedElementOwners(
  nodes: Record<string, PageNode> | null | undefined,
  installs: readonly RealmPluginInstall[],
): Record<string, string> {
  const owners: Record<string, string> = {}
  if (!nodes || typeof nodes !== 'object') return owners
  const namespaces = installs
    .filter((install) => typeof install.identity === 'string' && install.identity)
    .map((install) => ({ prefix: `${install.identity}.`, listingId: install.listingId }))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  if (!namespaces.length) return owners
  for (const [key, node] of Object.entries(nodes)) {
    const componentId = node?.componentId
    if (typeof componentId !== 'string' || !componentId.includes('.')) continue
    const owner = namespaces.find((namespace) => componentId.startsWith(namespace.prefix))
    if (!owner) continue
    const nodeId = typeof node?.$id === 'string' && node.$id ? node.$id : key
    owners[nodeId] = owner.listingId
  }
  return owners
}

/**
 * The enricher. A page with no element in a marketplace namespace — nearly
 * every page — returns before reading anything.
 */
export function createConnectionRecordsEnricher(deps: ConnectionRecordsEnricherDeps): SitePageEnricher {
  return async (context: SitePageContext) => {
    const nodes = context.nodes as Record<string, PageNode> | undefined
    if (!nodes || typeof nodes !== 'object') return undefined
    const anyNamespaced = Object.values(nodes).some(
      (node) => typeof node?.componentId === 'string' && node.componentId.includes('.'),
    )
    if (!anyNamespaced) return undefined
    const owners = signedElementOwners(nodes, await deps.realmInstalls(context.hostId))
    const listings = new Set(Object.values(owners))
    if (!listings.size) return undefined
    const records: PluginConnectionRecordsPageData['records'] = {}
    for (const entry of await deps.records(context.hostId)) {
      if (!listings.has(entry.listingId)) continue
      ;(records[entry.listingId] ??= {})[entry.connectionId] = entry.record
    }
    const attributed: Record<string, string> = {}
    for (const [nodeId, listingId] of Object.entries(owners)) {
      if (records[listingId]) attributed[nodeId] = listingId
    }
    if (!Object.keys(attributed).length) return undefined
    const data: PluginConnectionRecordsPageData = { nodes: attributed, records }
    return { [PLUGIN_CONNECTION_RECORDS_PROP]: data }
  }
}

/* ------------------------------------------------------------------ */
/* The repeat-rows reader                                               */
/* ------------------------------------------------------------------ */

/**
 * The rows a published page's repeats over a connection render (AGL-4212):
 * each `connection:<identity>/<connectionId>[/fields]` key answered from the
 * site's own records, through the one function the editor's canvas uses
 * (`pluginConnectionRepeatRows`).
 *
 * Gated exactly as the page enricher hands an element its records: the
 * identity must be a signed install allowed to run on THIS site (the page
 * loader's own read: not revoked, not taken down, switched on), and the
 * record one the site's pinned version still declares, on a plan with the
 * feature ({@link readSiteConnectionRecords}). A key that names anything
 * else — an identity not installed here, a connection it does not declare, a
 * malformed value — is left out, and its element renders no copies. Records
 * are read for `hostId` alone, so no key can reach another site's.
 *
 * A key that parses is answered even before a first sync: an items repeat
 * with no rows, a summary repeat with none, so both draw nothing.
 */
export function createConnectionRepeatRowReader(deps: ConnectionRecordsEnricherDeps): RepeatRowReader {
  return async ({ hostId, keys }) => {
    const answer: RepeatRowsAnswer = {}
    const targets = keys
      .map((key) => ({ key, target: parsePluginConnectionRepeat(key) }))
      .filter((one) => one.target !== null)
    if (!targets.length) return answer
    const installs = await deps.realmInstalls(hostId)
    const listingFor = new Map<string, string>()
    for (const install of installs) {
      if (typeof install.identity === 'string' && install.identity && !listingFor.has(install.identity)) {
        listingFor.set(install.identity, install.listingId)
      }
    }
    if (!listingFor.size) return answer
    const entries = await deps.records(hostId)
    for (const { key, target } of targets) {
      if (!target) continue
      const listingId = listingFor.get(target.identity)
      if (!listingId) continue
      const entry = entries.find((one) => one.listingId === listingId && one.connectionId === target.connectionId)
      if (!entry) {
        // Installed here but no record yet, or a connection it does not
        // declare: nothing to show either way.
        answer[key] = { records: [] }
        continue
      }
      answer[key] = pluginConnectionRepeatRows(entry.record, entry.types ?? { fields: {}, items: {} }, target.part)
    }
    return answer
  }
}

/* ------------------------------------------------------------------ */
/* The variable computer                                                */
/* ------------------------------------------------------------------ */

const unchanged: VariableComputation = ({ variables }) => variables

/**
 * Adds each record's summary-field variables to the site's own. A site's own
 * variable is never replaced: the ids cannot collide by construction
 * (`pluginConnectionVariableId`), and this holds even if one somehow did.
 */
export function createConnectionVariableComputer(deps: Pick<ConnectionRecordsEnricherDeps, 'records'>): VariableComputer {
  return {
    prepare: async (hostId) => {
      const entries = await deps.records(hostId)
      const computed: Record<string, HostVariable> = {}
      for (const entry of entries) Object.assign(computed, entry.variables)
      if (!Object.keys(computed).length) return unchanged
      return ({ variables }) => {
        const out = { ...variables }
        for (const [id, variable] of Object.entries(computed)) {
          if (!Object.prototype.hasOwnProperty.call(variables, id)) out[id] = variable
        }
        return out
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* The image hosts                                                      */
/* ------------------------------------------------------------------ */

export interface PluginImageHostsDeps {
  realmInstalls(hostId: string): Promise<readonly RealmPluginInstall[]>
  /** The `capabilities.imageHosts` the pinned version's manifest declares, unvalidated. */
  declaredImageHosts(listingId: string, version: string): Promise<unknown>
}

/**
 * The image hosts a site's signed plugins declare, each re-validated, in
 * install order, de-duplicated. A signed (realm) install is the only kind
 * whose elements draw into the page itself; a sandboxed plugin draws in a
 * frame of its own origin, which the page's `img-src` does not govern. A
 * declaration that no longer validates admits nothing at all.
 */
export async function siteDeclaredImageHosts(deps: PluginImageHostsDeps, hostId: string): Promise<string[]> {
  const installs = await deps.realmInstalls(hostId)
  if (!installs.length) return []
  const declared = await Promise.all(
    installs.map(async (install) => {
      try {
        const verdict = validatePluginImageHosts(await deps.declaredImageHosts(install.listingId, install.version))
        return verdict.ok ? verdict.value : []
      } catch (error) {
        console.error(`plugin-connections: the image hosts of ${install.listingId} were unreadable`, error)
        return []
      }
    }),
  )
  return [...new Set(declared.flat())]
}

/** The CSP source the tenant's verdict asks. */
export function createPluginImageHostsSource(hosts: (hostId: string) => Promise<string[]>): PluginSiteCspSource {
  return {
    hosts: async ({ hostId }) => {
      const img = await hosts(hostId)
      return img.length ? { img } : {}
    },
  }
}
