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
  mdiFilterVariant,
  MdiIcon,
  mdiPlus,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { objectRemap, str } from '@aglyn/shared-util-tools'
import { createUid } from '@aglyn/shared-util-vendor'
import IconButton from '@mui/material/IconButton'
import { useRouter } from 'next/navigation'
import { useSnackbar } from 'notistack'
import {
  type ChangeEvent,
  Fragment,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { DataTableComponent, type DataTableProps } from '@aglyn/shared-ui-jsx'
import { type AppContextType, withAppContext } from '../contexts/app-context'
import { type Fields } from '../forms'
import ConsoleLayout from '../layouts/ConsoleLayout'
import AreaManageNavigationListWidgetView from './AreaManageNavigationListWidgetView'
import DrawerFormView from './DrawerFormView'

const pageLen = 25

export interface AreaManageViewProps {
  collectionId: string
  documentName: {
    singular: string
    plural: string
  }
  documentId?: string
  fields: Fields.FieldGroup
  columns: DataTableProps['columns']

  onSaveSuccess?: (document: any) => void
  onSaveError?: (error: any) => void
  app: AppContextType
}

function AreaManageViewRaw(props: AreaManageViewProps) {
  const {
    app,
    columns,
    documentName,
    documentId,
    collectionId,
    fields,
    onSaveSuccess,
    onSaveError,
  } = props
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading, loading } = useLoading()
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  const [error, setError] = useState<any>(null)
  const [documents, setDocuments] = useState<{ [id: string]: any }>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [activeDocument, setActiveDocument] = useState<{
    type: 'updating' | 'creating'
    data: any
  }>(null)
  const query = app.getCollectionRef(collectionId)
  const rows = Object.entries(documents ?? {}).map(([id, v]) => ({ id, ...v }))
  const openForm = () => setFormOpen(true)
  const closeForm = () => setFormOpen(false)
  const clearActiveDocument = () => setActiveDocument(null)

  // Open document
  const handleDocumentOpen = async (documentId) => {
    await router.push(`${router.asPath}/${documentId}`)
  }
  // Handle table data row click
  const handleRowClick = (p) => {
    handleDocumentOpen(str(p.row.id))
  }
  // Close Document
  const removeDocumentIdFromUrl = useCallback(async () => {
    if (documentId) {
      await router.push(router.asPath.replace(`/${documentId}`, ''))
    }
  }, [documentId])

  // Close form
  const handleCloseForm = async () => {
    const dequeueLoader = queueLoading()
    closeForm()
    clearActiveDocument()
    await removeDocumentIdFromUrl()
    dequeueLoader()
  }

  // Update field on active document
  const handleFieldUpdate =
    (fieldId: string) =>
    (event: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const value = event.target.value
      setActiveDocument((prev) => ({
        ...prev,
        data: { ...prev.data, [fieldId]: value },
      }))
    }

  // Open create form
  const handleCreateDocumentFormOpen = async () => {
    const dequeueLoader = queueLoading()
    setActiveDocument({ type: 'creating', data: { id: createUid() } })
    openForm()
    dequeueLoader()
  }

  // Update/set remote document with active document
  const setRemoteDocument = useCallback(async () => {
    console.debug('Saving active document', activeDocument)
    const dequeueLoader = queueLoading()
    const { type, data } = activeDocument
    const { id: dataId, ...allExceptId } = data
    const id = dataId ?? createUid()
    await query
      .doc(id)
      .set(allExceptId)
      .then((res) => {
        const actionMsg = type === 'creating' ? 'Created' : 'Updated'
        enqueueSnackbar(`${actionMsg} successfully`, { variant: 'success' })
        onSaveSuccess && onSaveSuccess(activeDocument)
      })
      .catch((error) => {
        setError(error.message)
        enqueueSnackbar(error?.message, { variant: 'error' })
        onSaveError && onSaveError(error)
      })
    handleCloseForm()
    dequeueLoader()
  }, [query, activeDocument])

  // Load initial documents
  // React.useEffect(() => {
  //   setLoadingDocuments(true)
  //   query.get()
  //     .then(querySnapshot => {
  //       setDocuments(prev => {
  //         const items = { ...prev }
  //         querySnapshot.docs.forEach(doc => {
  //           items[doc.id] = { id: doc.id, ...doc.data() }
  //         })
  //         return items
  //       })
  //     })
  //     .catch(error => {
  //       console.error('Error loading initial items', error)
  //       enqueueSnackbar(error?.message, { variant: 'error' })
  //     })
  //     .finally(() => {
  //       setLoadingDocuments(false)
  //     })
  // }, [])

  // Listen for realtime updates
  useEffect(() => {
    const cancelListener = query.onSnapshot(
      (querySnapshot) => {
        setLoadingDocuments(true)
        setDocuments((prev) => {
          const items = { ...prev }
          querySnapshot.docChanges().forEach((change) => {
            if (change.type === 'removed') {
              console.debug('Removed document update: ', change.doc.data())
              delete items[change.doc.id]
            } else {
              console.debug('Updated document update: ', change.doc.data())
              items[change.doc.id] = { id: change.doc.id, ...change.doc.data() }
            }
          })
          return items
        })
        setLoadingDocuments(false)
      },
      (error) => {
        enqueueSnackbar(error?.message, { variant: 'error' })
      },
    )
    return () => {
      cancelListener()
    }
  }, [])

  // Setup the active document
  useEffect(() => {
    if (documentId && documents) {
      const document = documents[documentId]
      if (document) {
        setActiveDocument({ type: 'updating', data: document })
        setError(null)
      } else {
        setError('Item does not exist!')
        setActiveDocument(null)
        enqueueSnackbar('Error loading item', { variant: 'error' })
      }
    }
  }, [documentId, documents])

  const mappedFields = objectRemap(fields, (value) => ({
    ...value,
    value: activeDocument?.data[value.id] ?? value.value,
  }))

  return (
    <Fragment>
      <ConsoleLayout
        items={[
          {
            size: { xs: 12, md: 3 },
            children: <AreaManageNavigationListWidgetView />,
          },
          {
            size: { xs: 12, md: 9 },
            children: (
              <CardDisplay
                header={{
                  title: `All ${documentName.plural}`,
                  action: (
                    <Fragment>
                      <IconButton title="Filter list" disabled>
                        {<MdiIcon path={mdiFilterVariant.path} />}
                      </IconButton>
                      <IconButton
                        title="Add item"
                        onClick={handleCreateDocumentFormOpen}
                      >
                        {<MdiIcon path={mdiPlus.path} />}
                      </IconButton>
                    </Fragment>
                  ),
                }}
              >
                <DataTableComponent
                  loading={loadingDocuments}
                  onRowClick={handleRowClick}
                  columns={columns}
                  noRowsLabel={documentName.plural}
                  rows={rows}
                />
              </CardDisplay>
            ),
          },
        ]}
      />

      <DrawerFormView
        error={error || Boolean(documentId && !activeDocument)}
        fields={mappedFields}
        id={activeDocument?.data?.id}
        label={documentName.singular}
        loading={loading}
        open={Boolean(documentId || formOpen)}
        formVariant={activeDocument?.type}
        onClose={handleCloseForm}
        onSave={setRemoteDocument}
        onUpdate={handleFieldUpdate}
      />
    </Fragment>
  )
}

AreaManageViewRaw.displayName = 'AreaManageViewRaw'
AreaManageViewRaw.aglyn = true

export const AreaManageView = withAppContext(AreaManageViewRaw)
export default AreaManageView
