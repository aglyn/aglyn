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

import { BindingPickerContext, type BindingOption } from '@aglyn/besigner-ui'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'

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
  const { data: variableDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'variables'), limit(100)),
    { idField: '$id' },
  )
  const { data: functionDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'functions'), limit(100)),
    { idField: '$id' },
  )

  const value = useMemo(() => {
    const options: BindingOption[] = []
    for (const variable of variableDocs ?? []) {
      if (variable.deletedAt || !variable.name) continue
      options.push({
        group: 'Variables',
        label: variable.name,
        token: `{{${variable.name}}}`,
      })
    }
    for (const definition of functionDocs ?? []) {
      if (definition.deletedAt || !definition.name) continue
      const parameters = (definition.parameters ?? [])
        .map((parameter: any) => parameter.name)
        .join(', ')
      options.push({
        group: 'Functions',
        label: `${definition.name}(${parameters})`,
        token: `{{fn:${definition.name}(${parameters})}}`,
      })
    }
    return { options }
  }, [variableDocs, functionDocs])

  return (
    <BindingPickerContext.Provider value={value}>
      {children}
    </BindingPickerContext.Provider>
  )
}
BindingPickerProvider.displayName = 'BindingPickerProvider'

export default BindingPickerProvider
