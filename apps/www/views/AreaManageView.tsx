/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import React from 'react'
import { _s, mapObject } from '@aglyn/shared/util/tools'
import { createUid } from '@aglyn/shared/util/helpers'
import WidgetCard from '../components/WidgetCard'
import ConsoleLayout from '../layouts/ConsoleLayout'
import DataTable, { Props as DataTableProps } from '../components/DataTable'
import IconButton from '@material-ui/core/IconButton'
import { SvgPathIcon } from '@aglyn/shared/ui/react'
import AreaManageNavigationListWidgetView from './AreaManageNavigationListWidgetView'
import { withAppContext } from '../contexts/app-context'
import { useSnackbar } from 'notistack'
import { useAppLoader } from '../contexts/app-loader-context'
import DrawerFormView from './DrawerFormView'
import { Fields } from '../forms'
import { useRouter } from 'next/router'


const pageLen = 25

type Props = {
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
}


export default withAppContext<Props>(function AreaManageView(props) {
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
  const {enqueueSnackbar} = useSnackbar()
  const {queueLoading, isLoading} = useAppLoader()
  const [loadingDocuments, setLoadingDocuments] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [documents, setDocuments] = React.useState<{ [id: string]: any }>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [activeDocument, setActiveDocument] = React.useState<{ type: 'updating' | 'creating', data: any }>(null)
  const query = app.getCollectionRef(collectionId)
  const rows = Object.entries(documents ?? {}).map(([id, v]) => ({id, ...v}))
  const openForm = () => setFormOpen(true)
  const closeForm = () => setFormOpen(false)
  const clearActiveDocument = () => setActiveDocument(null)

  // Open document
  const handleDocumentOpen = async (documentId) => {
    await router.push(`${router.asPath}/${documentId}`)
  }
  // Handle table data row click
  const handleRowClick = (p) => {
    handleDocumentOpen(_s(p.row.id))
  }
  // Close Document
  const removeDocumentIdFromUrl = React.useCallback(async () => {
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
  const handleFieldUpdate = (fieldId: string) => (
    event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    const value = event.target.value
    setActiveDocument(prev => ({...prev, data: {...prev.data, [fieldId]: value}}))
  }

  // Open create form
  const handleCreateDocumentFormOpen = async () => {
    const dequeueLoader = queueLoading()
    setActiveDocument({type: 'creating', data: {id: createUid()}})
    openForm()
    dequeueLoader()
  }

  // Update/set remote document with active document
  const setRemoteDocument = React.useCallback(async () => {
    console.debug('Saving active document', activeDocument)
    const dequeueLoader = queueLoading()
    const {type, data} = activeDocument
    const {id: dataId, ...allExceptId} = data
    const id = dataId ?? createUid()
    await query.doc(id).set(allExceptId)
    .then((res) => {
      const actionMsg = type === 'creating' ? 'Created' : 'Updated'
      enqueueSnackbar(`${actionMsg} successfully`, {variant: 'success'})
      onSaveSuccess && onSaveSuccess(activeDocument)
    })
    .catch((error) => {
      setError(error.message)
      enqueueSnackbar(error?.message, {variant: 'error'})
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
  React.useEffect(() => {
    const cancelListener = query.onSnapshot((querySnapshot) => {
      setLoadingDocuments(true)
      setDocuments(prev => {
        const items = {...prev}
        querySnapshot.docChanges().forEach(change => {
          if (change.type === 'removed') {
            console.debug('Removed document update: ', change.doc.data())
            delete items[change.doc.id]
          } else {
            console.debug('Updated document update: ', change.doc.data())
            items[change.doc.id] = {id: change.doc.id, ...change.doc.data()}
          }
        })
        return items
      })
      setLoadingDocuments(false)
    }, (error) => {
      enqueueSnackbar(error?.message, {variant: 'error'})
    })
    return () => {
      cancelListener()
    }
  }, [])

  // Setup the active document
  React.useEffect(() => {
    if (documentId && documents) {
      const document = documents[documentId]
      if (document) {
        setActiveDocument({type: 'updating', data: document})
        setError(null)
      } else {
        setError('Item does not exist!')
        setActiveDocument(null)
        enqueueSnackbar('Error loading item', {variant: 'error'})
      }
    }
  }, [documentId, documents])

  return (
    <React.Fragment>
      <ConsoleLayout
        items={[
          {
            xs: 12, md: 3,
            children: (<AreaManageNavigationListWidgetView />),
          },
          {
            xs: 12, md: 9,
            children: (
              <WidgetCard
                header={{
                  title: `All ${documentName.plural}`,
                  action: (
                    <React.Fragment>
                      <IconButton
                        children={<SvgPathIcon iconId="filter-variant" />}
                        title="Filter list"
                        disabled
                      />
                      <IconButton
                        children={<SvgPathIcon iconId="plus" />}
                        title="Add item"
                        onClick={handleCreateDocumentFormOpen}
                      />
                    </React.Fragment>
                  ),
                }}
              >
                <DataTable
                  DataGridProps={{
                    loading: loadingDocuments,
                    onRowClick: handleRowClick,
                  }}
                  columns={columns}
                  label={documentName.plural}
                  rows={rows}
                />
              </WidgetCard>
            ),
          },
        ]}
      />

      <DrawerFormView
        error={error || Boolean(documentId && !activeDocument)}
        fields={mapObject(fields, (v) => ({...v, value: activeDocument?.data[v.id] ?? v.value}), {copy: true})}
        id={activeDocument?.data?.id}
        label={documentName.singular}
        loading={isLoading}
        open={Boolean(documentId || formOpen)}
        variant={activeDocument?.type}
        onClose={handleCloseForm}
        onSave={setRemoteDocument}
        onUpdate={handleFieldUpdate}
      />
    </React.Fragment>
  )
}, 'app')
