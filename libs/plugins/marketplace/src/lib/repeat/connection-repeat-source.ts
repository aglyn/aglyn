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

import { FieldComponentType } from '@aglyn/aglyn'
import {
  REPEAT_CONNECTION_KEY_PREFIX,
  REPEAT_CONNECTION_PROP,
} from '@aglyn/aglyn/app-utils/expand-repeatables'
import {
  EditorPluginConnectionsContext,
  type EditorConnectionRepeatable,
  type EditorPluginConnections,
} from '@aglyn/aglyn/app-utils/plugin-connection-editor'
import {
  parsePluginConnectionRepeat,
  PLUGIN_CONNECTION_ISO_SUFFIX,
  pluginConnectionRepeatFieldNames,
  pluginConnectionRepeatRows,
  pluginConnectionRepeatValue,
} from '@aglyn/aglyn/app-utils/plugin-connection-repeat'
import type {
  RepeatItemField,
  RepeatRowsAnswer,
  RepeatRowsRequest,
  RepeatSource,
} from '@aglyn/aglyn/app-utils/repeat-sources'
import { useContext, useMemo } from 'react'
import { CONNECTION_REPEAT_SOURCE_ID } from '../constants/bundle-common'
import { connectionFieldLabel } from '../model/editor-connections'

/*
 * A PLUGIN CONNECTION'S RECORD AS A REPEAT SOURCE, IN THE EDITOR (AGL-4212).
 *
 * What puts "Repeat over a connection" on an element's Attributes panel and
 * draws its copies on the canvas and in Preview. Everything it reads is
 * already in the editor: the marketplace's own `EditorConnectionsProvider`
 * reads the site's installs and records once (AGL-4196), and this turns them
 * into rows through core's `pluginConnectionRepeatRows`, the function the
 * published page's server reader uses. No fetch of its own.
 *
 * The source depends on the SITE — which connections it can pick, which
 * fields a token can name — and a source is a plain registered object, so the
 * provider registers it again whenever the site's connections change
 * ({@link connectionRepeatSource}); the registry announces each change.
 */

/** The declared connection a `repeatConnection` value names on this site, or `undefined`. */
export function connectionRepeatableFor(
  connections: EditorPluginConnections | undefined,
  key: string,
): EditorConnectionRepeatable | undefined {
  const target = parsePluginConnectionRepeat(key)
  if (!target) return undefined
  return connections?.repeatables?.find(
    (one) => one.identity === target.identity && one.connectionId === target.connectionId,
  )
}

/**
 * One key's rows for the canvas, under the key as the node stores it and as
 * `repeatKey` makes it (`connection:…`), which is what the expansion looks
 * the rows up by.
 *
 * `missing` for a key that names no connection of this site — and while the
 * editor knows of none at all, because the provider cannot tell a site with
 * no connections from one whose read has not landed, and a `loading` that
 * never ends would hold Preview on its spinner. A connection with no record
 * yet answers no rows, as the published page does.
 */
export function connectionRepeatAnswer(
  connections: EditorPluginConnections | undefined,
  key: string,
): RepeatRowsAnswer {
  const target = parsePluginConnectionRepeat(key)
  const repeatable = connectionRepeatableFor(connections, key)
  if (!target || !repeatable || !connections) return { status: 'missing' }
  const record = connections.records[repeatable.listingId]?.[repeatable.connectionId] ?? null
  const rows = pluginConnectionRepeatRows(record, repeatable.types, target.part)
  const value = key.trim()
  return {
    status: 'ready',
    label: target.part === 'fields' ? `${repeatable.label} summary` : repeatable.label,
    rowsByKey: { [value]: rows, [`${REPEAT_CONNECTION_KEY_PREFIX}${value}`]: rows },
  }
}

/** The canvas's reader: the provider's records, never a read of its own. */
export function useConnectionRepeatRows(request: RepeatRowsRequest): RepeatRowsAnswer {
  const connections = useContext(EditorPluginConnectionsContext)
  return useMemo(() => connectionRepeatAnswer(connections, request.key), [connections, request.key])
}

/**
 * What the picker lists: each connection's items and its summary, by the
 * connection's label. Never an id an author types.
 */
export function connectionRepeatOptions(
  connections: EditorPluginConnections | undefined,
): Array<{ value: string; label: string }> {
  const repeatables = connections?.repeatables ?? []
  const options = [{ value: '', label: repeatables.length ? 'None' : 'No connections on this site' }]
  for (const one of repeatables) {
    const target = { identity: one.identity, connectionId: one.connectionId }
    if (Object.keys(one.types.items).length) {
      options.push({
        value: pluginConnectionRepeatValue({ ...target, part: 'items' }),
        label: `${one.label}: each item`,
      })
    }
    if (Object.keys(one.types.fields).length) {
      options.push({
        value: pluginConnectionRepeatValue({ ...target, part: 'fields' }),
        label: `${one.label}: summary`,
      })
    }
  }
  return options
}

/** The fields a key's `{{item.*}}` tokens can name, as the insert-token menu lists them. */
export function connectionRepeatFields(
  connections: EditorPluginConnections | undefined,
  key: string,
): RepeatItemField[] | undefined {
  const target = parsePluginConnectionRepeat(key)
  const repeatable = connectionRepeatableFor(connections, key)
  if (!target || !repeatable) return undefined
  return pluginConnectionRepeatFieldNames(repeatable.types, target.part).map((id) => {
    const iso = id.endsWith(PLUGIN_CONNECTION_ISO_SUFFIX) ? id.slice(0, -PLUGIN_CONNECTION_ISO_SUFFIX.length) : ''
    const declared = target.part === 'fields' ? repeatable.types.fields : repeatable.types.items
    return {
      id,
      label: iso && !(id in declared) ? `${connectionFieldLabel(iso)} (ISO date)` : connectionFieldLabel(id),
    }
  })
}

/**
 * The source for a site's connections (`undefined`: none known). Registered
 * with none by the console registrar, and again by the provider each time the
 * site's connections change: the same id and the same reader hook every time,
 * so the canvas's mounted readers keep their hooks.
 *
 * With nothing to pick, the source is not `offered`: its picker is drawn only
 * on an element that already repeats over a connection, so an author can
 * clear it, and every other element's panel is not handed an empty dropdown.
 */
export function connectionRepeatSource(connections?: EditorPluginConnections): RepeatSource {
  return {
    id: CONNECTION_REPEAT_SOURCE_ID,
    label: 'Connection',
    keyProp: REPEAT_CONNECTION_PROP,
    keyAttribute: {
      component: FieldComponentType.SELECT,
      label: 'Repeat over a connection',
      description:
        'Render this element once per item a connected service synced to ' +
        'this site — or once for its summary — on the published site. Use ' +
        '{{item.field}} for a value.',
      options: connectionRepeatOptions(connections),
    },
    offered: Boolean(connections?.repeatables?.length),
    fields: (key) => connectionRepeatFields(connections, key),
    useRows: useConnectionRepeatRows,
  }
}
