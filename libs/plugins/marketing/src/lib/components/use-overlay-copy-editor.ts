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
'use client'

import {
  type BindingDocRef,
  editableBindingTokens,
  type HostTokenSource,
  type HostVariable,
  normalizeBindingTokens,
} from '@aglyn/aglyn'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  overlayCopyTokensShownAsTyped,
  resolveOverlayCopy,
} from '../model/overlay-copy'

/**
 * How many variables an editor reads: the ceiling the published page reads
 * them under, so the editor never recognizes a name the page cannot fill in.
 */
const VARIABLES_CEILING = 100

type VariableDoc = HostVariable & { $id: string; deletedAt?: unknown }

export interface OverlayCopyEditor {
  /**
   * Stored copy as the author reads it in the text field: a variable's
   * `{{var:id}}` shows as the `{{name}}` they typed.
   */
  editable: (text: string | undefined) => string
  /**
   * Typed copy as it is stored: each `{{name}}` of a variable on this site
   * becomes its rename-safe `{{var:id}}`, the only variable form a published
   * page resolves. A name no variable carries is left as typed.
   */
  stored: (text: string | undefined) => string | undefined
  /**
   * {@link stored}, capped at `max` characters as the author reads them — a
   * cap applied to the stored form could cut an id token in half, and half a
   * token reaches the visitor as typed.
   */
  storedWithin: (text: string | undefined, max: number) => string
  /** What a visitor reads for this copy on the published site. */
  preview: (text: string | undefined) => string
  /**
   * Tokens in this copy that a visitor would read exactly as typed. Empty
   * until the variables have been read, because until then a name the site
   * does have would be reported too.
   */
  shownAsTyped: (text: string | undefined) => string[]
  /**
   * Whether any of this copy holds a token while the site's variables are
   * still being read. Stored now, a name the site does have would be saved in
   * the form no published page resolves.
   */
  pending: (...texts: Array<string | undefined>) => boolean
}

/**
 * Overlay copy — an announcement bar's text, a popup's headline and body —
 * edited against the site's variables (AGL-2885).
 *
 * A published page resolves a variable only in its `{{var:id}}` form, while
 * an author types `{{saleEndsAt}}`. So a name is rewritten to its id token on
 * the way into storage and back on the way into the text field, the same
 * normalization the Besigner applies when an element saves, and a token that
 * would still reach a visitor as typed is reported rather than saved in
 * silence.
 *
 * Callers hold copy in its STORED form and show {@link OverlayCopyEditor.editable}
 * of it, converting each change with {@link OverlayCopyEditor.stored}. A
 * field seeded before the variables arrive then catches up on its own, with no
 * second seed to race the author's typing.
 *
 * The variables are read only once some copy holds a token, since most bars
 * and popups are plain text, and stay read after that, so deleting a token and
 * typing it again does not read them twice.
 */
export function useOverlayCopyEditor(options: {
  hostId: string
  /**
   * The site document, for the details `preview` fills in. Optional for an
   * editor with no preview: a `{{host.*}}` token always renders as the detail
   * or as nothing, so whether a token shows as typed never depends on it.
   */
  host?: HostTokenSource | null
  /** Whether any copy this editor holds contains a `{{` token. */
  usesTokens: boolean
}): OverlayCopyEditor {
  const { hostId, host, usesTokens } = options
  const firestore = useFirestore()
  // Latched during render, React's pattern for state derived from an earlier
  // render: once any copy has held a token, the read stays open.
  const [wanted, setWanted] = useState(usesTokens)
  if (usesTokens && !wanted) setWanted(true)
  const { data: variableDocs, status } = useFirestoreCollection<VariableDoc>(
    () =>
      wanted
        ? query(
            collection(firestore, 'hosts', hostId, 'variables'),
            limit(VARIABLES_CEILING),
          )
        : null,
    [firestore, hostId, wanted],
    { idField: '$id' },
  )
  const settled = wanted && status !== 'loading'

  return useMemo(() => {
    // Keyed by id for resolution, as the published page keys them, and by
    // name for the typed form. A deleted variable is neither: the page does
    // not read one.
    const byId: Record<string, HostVariable> = {}
    const byName: Record<string, BindingDocRef> = {}
    for (const variable of variableDocs ?? []) {
      if (!variable?.name || variable.deletedAt) continue
      byId[variable.$id] = variable
      byName[variable.name] = variable
    }
    const editable = (text: string | undefined) =>
      typeof text === 'string' ? editableBindingTokens(text, byName) : ''
    const stored = (text: string | undefined) =>
      typeof text === 'string' && text.includes('{{')
        ? normalizeBindingTokens(text, byName)
        : text
    return {
      editable,
      stored,
      storedWithin: (text, max) => stored(editable(text).slice(0, max)) ?? '',
      preview: (text) => resolveOverlayCopy(stored(text) ?? '', byId, host),
      shownAsTyped: (text) =>
        settled ? overlayCopyTokensShownAsTyped(stored(text), byId, host) : [],
      pending: (...texts) =>
        !settled && texts.some((text) => Boolean(text?.includes('{{'))),
    }
  }, [variableDocs, settled, host])
}

/**
 * What a copy field says about variables while nothing in it is wrong.
 *
 * A placeholder rather than an example name: an example names a variable most
 * sites do not have, and a token for a variable the site does not have is
 * exactly what reaches a visitor as typed.
 */
export const OVERLAY_COPY_HELPER_TEXT =
  'To show a variable from Logic, type its name in double braces, like {{name}}'

/**
 * The helper text a copy field shows when some of its tokens would reach a
 * visitor as typed, or undefined when none would.
 */
export function shownAsTypedHelperText(tokens: string[]): string | undefined {
  if (!tokens.length) return undefined
  const list = tokens.join(', ')
  return (
    `Visitors would see ${list} exactly as typed. Use the name of a ` +
    'variable from Logic, or remove the braces.'
  )
}

export default useOverlayCopyEditor
