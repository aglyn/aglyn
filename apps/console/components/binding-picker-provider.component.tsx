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
  formatFunctionIdToken,
  formatVariableIdToken,
  type ReusableComponentProp,
} from '@aglyn/aglyn'
import { describeHostTokens } from '@aglyn/aglyn/app-utils/host-tokens'
import { BindingPickerContext, type BindingOption } from '@aglyn/besigner-ui'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface BindingPickerProviderProps {
  hostId: string
  children?: JSX.Children
}

/**
 * Feeds the designer's "Insert binding" menu (AGL-100) with the host's
 * variables and functions. Function tokens template every parameter name
 * so the editor sees what to fill in.
 */
export function BindingPickerProvider(props: BindingPickerProviderProps) {
  const { hostId, children } = props
  const firestore = useFirestore()
  const { data: variableDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'variables'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: functionDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'functions'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  // The site itself, for `host.*` tokens (AGL-1023). One doc, already cached
  // by every other surface on the page.
  const { data: hostDoc } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  /**
   * The reusable component being edited, for its declared props (AGL-1335).
   *
   * Read from the ROUTE rather than passed in, because that is the only
   * thing that actually distinguishes the surfaces: this provider wraps five
   * editors and only the component one has a `componentId`, so the null ref
   * below is what keeps the other four from subscribing to anything. The
   * page already listens to this exact document, and the Firestore SDK
   * shares one listener per ref — so this is a second reader, not a second
   * read.
   *
   * Deliberately WITHOUT the version converter: only `props` is wanted here,
   * and the converter exists to decompress `nodes`, which would be pure cost
   * for a picker list.
   */
  const params = useParams<{ componentId?: string; versionId?: string }>()
  const componentId =
    typeof params?.componentId === 'string' ? params.componentId : ''
  const versionId = typeof params?.versionId === 'string' ? params.versionId : ''
  const { data: componentVersionDoc } = useFirestoreDoc<any>(
    () =>
      hostId && componentId && versionId
        ? doc(
            firestore,
            'hosts',
            hostId,
            'components',
            componentId,
            'versions',
            versionId,
          )
        : null,
    [firestore, hostId, componentId, versionId],
  )
  const componentProps = Array.isArray(componentVersionDoc?.props)
    ? (componentVersionDoc.props as ReusableComponentProp[])
    : undefined

  const value = useMemo(() => {
    // Inserted tokens carry doc ids (AGL-186) so they survive renames;
    // labels stay the friendly names.
    const options: BindingOption[] = []
    for (const variable of variableDocs ?? []) {
      if (variable.deletedAt || !variable.name) continue
      // Live value preview (AGL-262): show what the binding resolves to.
      const preview = String(variable.value ?? '').slice(0, 60)
      options.push({
        group: 'Variables',
        label: variable.name,
        token: formatVariableIdToken(variable.$id),
        ...(preview ? { preview } : {}),
      })
    }
    for (const definition of functionDocs ?? []) {
      if (definition.deletedAt || !definition.name) continue
      const parameters = (definition.parameters ?? []).map(
        (parameter: any) => parameter.name,
      )
      options.push({
        group: 'Functions',
        label: `${definition.name}(${parameters.join(', ')})`,
        token: formatFunctionIdToken(definition.$id, parameters),
        preview: parameters.length
          ? `Runs with ${parameters.length} argument${
              parameters.length === 1 ? '' : 's'
            }`
          : 'Runs with no arguments',
      })
    }
    /**
     * Host variables (AGL-1023), from the SAME registry that resolves them at
     * render — so the list cannot go stale against what actually substitutes.
     *
     * Image-typed tokens are withheld here rather than offered and validated
     * afterwards. This menu inserts into free text, and `{{host.logo}}` in a
     * sentence is a URL sitting mid-paragraph — the wrong-slot mistake
     * `validateHostTokens` exists to catch. Not offering it in a slot that
     * cannot take it is the same rule enforced one step earlier, where the
     * author never has to be corrected.
     */
    for (const token of describeHostTokens(hostDoc)) {
      if (token.type === 'image') continue
      options.push({
        group: 'Site',
        groupHint: 'Filled in from this site when the page renders or an email sends',
        label: token.label,
        token: token.token,
        // The empty case, visible at the moment of choosing — "what does this
        // look like for a site with no support email" is exactly what an
        // author never checks otherwise.
        preview: token.set
          ? String(token.value).slice(0, 60)
          : 'Not set on this site — renders as nothing',
      })
    }
        // Live canvas resolution (AGL-97): id keys serve resolveBindings;
    // name keys stay ONLY for save-time typed-name normalization
    // (normalizeBindingTokens looks names up as map keys) — the retired
    // legacy pass (AGL-194) no longer reads them at render.
    const variables: Record<string, any> = {}
    for (const variable of variableDocs ?? []) {
      if (variable.deletedAt || !variable.name) continue
      variables[variable.name] = variable
    }
    for (const variable of variableDocs ?? []) {
      if (variable.deletedAt || !variable.name) continue
      variables[variable.$id] = variable
    }
    const functions: Record<string, any> = {}
    for (const definition of functionDocs ?? []) {
      if (definition.deletedAt || !definition.name) continue
      functions[definition.name] = definition
    }
    for (const definition of functionDocs ?? []) {
      if (definition.deletedAt || !definition.name) continue
      functions[definition.$id] = definition
    }
    return { options, variables, functions, componentProps }
  }, [variableDocs, functionDocs, hostDoc, componentProps])

  return (
    <BindingPickerContext.Provider value={value}>
      {children}
    </BindingPickerContext.Provider>
  )
}
BindingPickerProvider.displayName = 'BindingPickerProvider'

export default BindingPickerProvider
