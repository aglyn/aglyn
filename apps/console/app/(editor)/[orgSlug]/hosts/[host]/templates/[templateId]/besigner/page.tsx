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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import type { JsonEditorProps } from '@aglyn/shared-ui-json-editor'
import {
  useAddElementDrawerCallback,
  withBesignerContext,
  type WorkspaceEditorComponentProps,
} from '@aglyn/besigner-ui'
import {
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_MODIFY_SAVE,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  LOADING_OVERLAY_ELEMENT,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  getGoogleFontsUrl,
  HostThemeDocumentContext,
} from '@aglyn/shared-ui-theme'
import { useHost, useHostTemplate } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { collection, doc, limit, query, updateDoc } from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import Head from 'next/head'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// Dynamic site-plugin activation (AGL-417): canvas components register
// via the org-gated loader; the page gates the canvas on readiness.
import { withSitePlugins } from '../../../../../../../../components/console-plugins-gate.component'
import BesignerFunctionsButton from '../../../../../../../../components/besigner-functions-button.component'
import BindingPickerProvider from '../../../../../../../../components/binding-picker-provider.component'
import InteractionsProvider from '../../../../../../../../components/interactions-provider.component'
import BesignerMediaPickerProvider from '../../../../../../../../components/besigner-media-picker-provider.component'
import BesignerAppBarComponent from '../../../../../../../../components/besigner-app-bar.component'
import BesignerDocumentSwitcherComponent from '../../../../../../../../components/besigner-document-switcher.component'
import BesignerVersionsComponent from '../../../../../../../../components/besigner-versions.component'
import EntityPickerProvider from '../../../../../../../../components/entity-picker-provider.component'
import ReusableComponentsProvider from '../../../../../../../../components/reusable-components-provider.component'
import AuthenticatedLayout from '../../../../../../../../components/layouts/authenticated.layout'
import MainLayout from '../../../../../../../../components/layouts/main.layout'
import '../../../../../../../../constants/app-setup'
import { buildRoute, Route } from '../../../../../../../../constants/route-links'
import { useHostId, useHostSubdomain } from '../../../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../../../hooks/use-org-scope'
import useFirestoreCollection from '../../../../../../../../hooks/use-firestore-collection'


const WorkspaceEditorComponent = dynamic<WorkspaceEditorComponentProps>(
  () =>
    import('@aglyn/besigner-ui').then((mod) => mod.WorkspaceEditorComponent),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)
const ViewportRootComponent = dynamic<WorkspaceEditorComponentProps>(
  () => import('@aglyn/besigner-ui').then((mod) => mod.ViewportRootComponent),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)
const ViewportCanvasComponent = dynamic<WorkspaceEditorComponentProps>(
  () => import('@aglyn/besigner-ui').then((mod) => mod.ViewportCanvasComponent),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)
const JsonEditor = dynamic<JsonEditorProps>(
  () => import('@aglyn/shared-ui-json-editor').then((mod) => mod.JsonEditor),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)

function setLocalNodes(value: Aglyn.ProcessableNodes) {
  const parsed = Aglyn.canvas.processNodesToDenormalized(value)
  const nodes = Aglyn.canvas.setNodes(parsed)
  return nodes
}

function TemplateBesignerPage(props) {
  const params = useParams<{
    hostId: string
    templateId: string
  }>()
  const hostId = useHostId()
  const templateId = params?.templateId as string
  const { enqueueSnackbar } = useSnackbar()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { queueLoading } = useLoading()
  const saveAvailable = !Aglyn.canvas.isInitialSame
  const handleAddElementClick = useAddElementDrawerCallback()
  const listUrl = buildRoute(Route.HOST_COMPONENTS, { orgSlug,  host })
  const { doc: hostResult } = useHost({ hostId })

  // Id-based screen links: a component can contain a link, so the canvas needs the routing map to resolve hrefs and the
  // Attributes panel needs screen names for the screen-select field.
  const firestore = useFirestore()
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const screenLinks = useMemo(
    () => ({
      screens: hostResult?.data?.screens as Record<string, string> | undefined,
      labels: Object.fromEntries(
        (screenDocs ?? []).map((screen: any) => [
          screen.$id,
          screen.displayName ?? screen.$id,
        ]),
      ),
      suppressNavigation: true,
    }),
    [hostResult?.data?.screens, screenDocs],
  )
  const { doc: result, setDoc: updateTemplate } = useHostTemplate({
    hostId,
    templateId,
  })
  const { data, status, error } = result
  const nodes = data?.nodes
  const hasError = Boolean(error) || status === 'error'
  const notFound = status === 'success' && !data

  // Deliberately NO viewType override: a component edits like screen
  // content. The LAYOUT view is what exposes the LayoutSlot outlet in the
  // element drawer, and a slot inside a reusable component would have
  // nowhere to graft (AGL-680).

  // The canvas is a singleton shared by every editing session; without a
  // reset on leave, client-side navigation to a screen or another layout
  // keeps (and could save) this document's nodes.
  useEffect(() => {
    return () => {
      Aglyn.canvas.reset()
      Besigner.focus.clearFocusStatus()
    }
  }, [hostId, templateId])

  useEffect(() => {
    if (status === 'loading') {
      return queueLoading()
    }
  }, [status])

  // Concurrent-edit detection (AGL-674), same as the screen editor: a
  // layout version is written as one whole node map, so without this the
  // later save silently replaces the earlier one.
  const baseStampRef = useRef<string | null>(null)
  /** Set when we save, so the resulting snapshot is adopted, not flagged. */
  const expectOwnWriteRef = useRef(false)
  const [remoteChanged, setRemoteChanged] = useState(false)

  useEffect(() => {
    if (nodes && !Aglyn.canvas.didSetInitial) {
      setLocalNodes(nodes)
      Aglyn.canvas.updateInitialNodes()
      baseStampRef.current = Aglyn.versionStamp(
        (data as { updatedAt?: unknown } | undefined)?.updatedAt,
      )
    }
  }, [nodes])

  useEffect(() => {
    const stored = Aglyn.versionStamp(
      (data as { updatedAt?: unknown } | undefined)?.updatedAt,
    )
    if (!Aglyn.hasConcurrentWrite(baseStampRef.current, stored)) return
    if (expectOwnWriteRef.current) {
      // The echo of our own save landing.
      expectOwnWriteRef.current = false
      baseStampRef.current = stored
      return
    }
    setRemoteChanged(true)
  }, [data])

  const handleSave = useCallback(async () => {
    if (!saveAvailable) {
      return enqueueSnackbar('Already saved', {
        variant: 'info',
        persist: false,
      })
    }
    // Refuse rather than merge — their work and yours are both still
    // intact, which a bad automatic merge cannot promise.
    if (remoteChanged) {
      return enqueueSnackbar(new Aglyn.ConcurrentEditError().message, {
        variant: 'warning',
        allowDuplicate: true,
      })
    }
    const dequeueLoading = queueLoading()

    const nodes = Aglyn.canvas.toJSON().nodes
    // Placeholders are DERIVED from the tokens in the content (AGL-672), so
    // editing has to recompute them: otherwise a template goes on asking
    // for a placeholder its copy no longer contains, or silently stops
    // asking for one the author just added. Existing labels and defaults
    // survive for tokens that are still there.
    const declared = Aglyn.detectTemplatePlaceholders(
      nodes as Record<string, unknown>,
    )
    const previous = new Map(
      ((data?.placeholders ?? []) as Array<{ name: string }>).map((entry) => [
        entry.name,
        entry,
      ]),
    )
    const placeholders = declared.map(
      (name) => previous.get(name) ?? { name },
    )
    const saveTemplate = updateTemplate as unknown as (
      value: Partial<Aglyn.AglynTemplate>,
      options?: Parameters<typeof updateTemplate>[1],
    ) => Promise<void>
    await saveTemplate(
      {
        nodes: nodes as unknown as Aglyn.AglynTemplate['nodes'],
        placeholders,
        // Records that this copy has diverged from what was installed.
        // `source` itself stays server-managed and frozen (AGL-666) so
        // provenance cannot be forged; "I edited my own copy" is a claim
        // nobody gains by lying about.
        editedAt: Timestamp.now(),
      } as Partial<Aglyn.AglynTemplate>,
      { merge: true },
    )
      .then(() => {
        Aglyn.canvas.updateInitialNodes(nodes)
        // Our own write moves the stamp; the new value arrives on the next
        // snapshot, so mark it as ours rather than somebody else's edit.
        expectOwnWriteRef.current = true
        setRemoteChanged(false)
        enqueueSnackbar('Template saved', {
          variant: 'success',
          persist: false,
        })
      })
      .catch((e) => {
        enqueueSnackbar(`Error: ${JSON.stringify(e)}`, {
          variant: 'error',
          allowDuplicate: true,
        })
      })
      .finally(() => {
        dequeueLoading()
      })
  }, [
    saveAvailable,
    remoteChanged,
    updateTemplate,
    data?.placeholders,
    enqueueSnackbar,
    queueLoading,
  ])

  // No publish step: a template is inert by definition — nothing renders
  // from it until it is used to create a page, component or layout, so
  // there is no draft-versus-live distinction to maintain (AGL-681).

  const [jsonOpen, setJsonOpen] = useState(false)
  const openJsonEditor = useCallback(() => setJsonOpen(true), [])
  const closeJsonEditor = useCallback(() => setJsonOpen(false), [])
  const handleJsonSave = useCallback((e, value) => {
    Aglyn.canvas.applyNodes(value)
    setJsonOpen(false)
  }, [])

  const hostTheme = hostResult?.data?.theme
  const hostFontsHref = useMemo(
    () => getGoogleFontsUrl(hostTheme?.fonts),
    [hostTheme?.fonts],
  )

  useEffect(() => {
    if (hasError) {
      enqueueSnackbar(`Error: ${error?.message}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    } else if (notFound) {
      enqueueSnackbar('404: Layout not found', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [enqueueSnackbar, hasError, error, notFound])

  return (
    <HostThemeDocumentContext.Provider value={hostTheme}>
    <Aglyn.ScreenLinkContext.Provider value={screenLinks}>
    <EntityPickerProvider hostId={hostId}>
    <ReusableComponentsProvider hostId={hostId}>
    <BindingPickerProvider hostId={hostId}>
    <InteractionsProvider hostId={hostId}>
    <BesignerMediaPickerProvider hostId={hostId}>
      {hostFontsHref ? (
        <Head>
          <link
            key="host-fonts-preconnect"
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link key="host-fonts" rel="stylesheet" href={hostFontsHref} />
        </Head>
      ) : null}
      <MainLayout
        title={'Besigner'}
        enableAppBarElevation
        besigner
        actionsPrefix={
          <>
            <BesignerFunctionsButton hostId={hostId} />
            {/* No version switcher yet: BesignerVersionsComponent maps any
                non-screen parent to the "layouts" collection, so pointing
                it at a component would write its versions to the wrong
                place entirely. Tracked separately rather than shipped
                broken (AGL-680). */}
          </>
        }
        backButton={
          {
            component: AppLink,
            componentVariant: 'naked',
            href: listUrl,
          } as any
        }
        centerNavigationItems={[
          {
            id: 'center-nav-file',
            children: 'File',
            items: [
              {
                id: 'center-nav-file-save',
                disabled: !saveAvailable,
                icon: saveAvailable
                  ? { path: ICON_VARIANT_MODIFY_SAVE.path }
                  : { path: ICON_VARIANT_SYMBOL_CONFIRMED.path },
                children: saveAvailable ? 'Save' : 'Up to Date',
                onClick: handleSave,
              },
              {
                id: 'center-nav-file-close',
                children: 'Close',
                href: listUrl,
                component: AppLink,
                componentVariant: 'naked',
                ListItemTextProps: { inset: true },
              },
            ],
          },
          {
            id: 'center-nav-edit',
            children: 'Edit',
            items: [
              {
                id: 'center-nav-edit-undo',
                children: 'Undo',
                onClick: () => Aglyn.canvas.undo(),
                disabled: !Aglyn.canvas.canUndo,
                ListItemTextProps: { inset: true },
              },
              {
                id: 'center-nav-edit-redo',
                children: 'Redo',
                onClick: () => Aglyn.canvas.redo(),
                disabled: !Aglyn.canvas.canRedo,
                ListItemTextProps: { inset: true },
              },
              {
                type: 'divider',
              },
              {
                id: 'center-nav-edit-rawjson',
                children: 'Raw JSON',
                onClick: () => openJsonEditor(),
                ListItemTextProps: { inset: true },
              },
            ],
          },
          {
            id: 'center-nav-insert',
            children: 'Insert',
            items: [
              {
                id: 'center-nav-insert-element',
                icon: {
                  path: ICON_VARIANT_MODIFY_ADD.path,
                },
                children: 'New Element',
                // Capture the current selection as the insert target when
                // the picker opens. Passing the callback directly handed the
                // menu click event in as `parent`, which both detached the
                // created node from the tree and broke placement-constraint
                // validation (AGL-537).
                onClick: () =>
                  handleAddElementClick(Besigner.focus.getLastSelected()),
              },
            ],
          },
        ]}
      >
        <NextPageTitle screen={'Template Besigner'} />

        {error || notFound ? (
          <Stack
            sx={{
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography>{'Not found'}</Typography>
          </Stack>
        ) : status === 'loading' ? (
          LOADING_OVERLAY_ELEMENT
        ) : (
          <>
            <BesignerAppBarComponent
              detailsUrl={listUrl}
              onSave={handleSave}
              saveAvailable={saveAvailable}
            />
            {/* Shown as soon as their save lands, not on Save — finding out
                after twenty more minutes of editing is the bad version of
                this (AGL-674). */}
            {remoteChanged ? (
              <Alert
                severity="warning"
                sx={{ borderRadius: 0, position: 'relative', zIndex: 'appBar' }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => window.location.reload()}
                  >
                    {'Reload'}
                  </Button>
                }
              >
                {'Someone else saved this layout while you were editing. ' +
                  'Saving is paused so their work is not overwritten — ' +
                  'reload to pick up their changes. Nothing you have done ' +
                  'here is lost until you do.'}
              </Alert>
            ) : null}
            <WorkspaceEditorComponent>
              <ViewportRootComponent>
                <ViewportCanvasComponent />
              </ViewportRootComponent>
            </WorkspaceEditorComponent>
          </>
        )}
      </MainLayout>
      {Boolean(Aglyn.canvas.rootNode && jsonOpen) && (
        <JsonEditor
          open={Boolean(Aglyn.canvas.rootNode && jsonOpen)}
          onClose={closeJsonEditor}
          onSave={handleJsonSave}
          defaultValue={Aglyn.canvas.nestedNodes as any}
        />
      )}
    </BesignerMediaPickerProvider>
    </InteractionsProvider>
    </BindingPickerProvider>
    </ReusableComponentsProvider>
    </EntityPickerProvider>
    </Aglyn.ScreenLinkContext.Provider>
    </HostThemeDocumentContext.Provider>
  )
}

TemplateBesignerPage.displayName = 'Page:LayoutBesigner'

export default withSitePlugins(withBesignerContext(observer(TemplateBesignerPage)))
