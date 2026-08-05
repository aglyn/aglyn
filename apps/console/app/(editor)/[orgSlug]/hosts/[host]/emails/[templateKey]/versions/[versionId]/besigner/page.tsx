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

import BindingPickerProvider from '../../../../../../../../../../components/binding-picker-provider.component'
import { getSessionHealth } from '../../../../../../../../../../utils/session-health'
import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import {
  BesignerDraftAlertComponent,
  CloseableDrawerComponent,
  useAddElementDrawerCallback,
  useBesignerDocument,
  withBesignerContext,
  type WorkspaceEditorComponentProps,
} from '@aglyn/besigner-ui'
import {
  ICON_VARIANT_MODIFY_ADD,
  ICON_VARIANT_MODIFY_SAVE,
  ICON_VARIANT_SYMBOL_CONFIRMED,
} from '@aglyn/shared-data-enums'
import type { JsonEditorProps } from '@aglyn/shared-ui-json-editor'
import {
  AppLink,
  LOADING_OVERLAY_ELEMENT,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  TENANT_EMAIL_COLLECTION,
  getTenantEmail,
  isTenantEmailEditable,
} from '@aglyn/shared-util-email'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { doc, setDoc, Timestamp } from 'firebase/firestore'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import BesignerAppBarComponent from '../../../../../../../../../../components/besigner-app-bar.component'
import BesignerMediaPickerProvider from '../../../../../../../../../../components/besigner-media-picker-provider.component'
import { useHostId, useHostSubdomain } from '../../../../../../../../../../components/host-id-provider'
import MainLayout from '../../../../../../../../../../components/layouts/main.layout'
import '../../../../../../../../../../constants/app-setup'
import { consolePluginLoader } from '../../../../../../../../../../constants/console-plugin-loader'
import { buildRoute, Route } from '../../../../../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../../../../../hooks/use-org-scope'
import useFirestoreDoc from '../../../../../../../../../../hooks/use-firestore-doc'

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

/**
 * The canvas components this editor needs. Loaded directly rather than via
 * `withSitePlugins` for the same reason the system-email editor does (AGL-759):
 * the EMAIL view only ever offers email blocks, and the always-on `mui` bundle
 * activates alongside. One `ensure` resolves either registration order now.
 */
function useHostEmailComponentsReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    void consolePluginLoader.ensure(['email'], ['site']).then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
    }
  }, [])
  return ready
}

interface HostEmailTemplateState {
  subject?: string
  preheader?: string
  versionId?: string
}

interface HostEmailVersionState {
  nodes?: Aglyn.ProcessableNodes
  updatedAt?: unknown
}

/**
 * Per-site email besigner (AGL-770). A site owner designs one of the
 * transactional emails their site sends its customers; the template lives at
 * `hosts/{hostId}/emailTemplates/{key}` and the plugin send site renders it
 * (falling back to built-in copy when nothing is published).
 *
 * The host-scoped sibling of the staff system-email editor (AGL-749). Unlike
 * that one it HAS a host, so "Browse media" works — the host media picker is
 * mounted here (the gap AGL-761 named applied only to the host-free editor).
 */
function HostEmailBesignerPage() {
  const params = useParams<{ templateKey: string; versionId: string }>()
  const templateKey = params?.templateKey as string
  const versionId = params?.versionId as string
  const firestore = useFirestore()
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const handleAddElementClick = useAddElementDrawerCallback()
  const listUrl = `${buildRoute(Route.HOST_SETUP, { orgSlug, host })}?tab=emails`

  const definition = getTenantEmail(templateKey)
  const editable = Boolean(definition && isTenantEmailEditable(definition))

  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [subjectInput, setSubjectInput] = useState<string | null>(null)
  const [preheaderInput, setPreheaderInput] = useState<string | null>(null)

  const { data: template } = useFirestoreDoc<HostEmailTemplateState>(
    () =>
      editable && hostId
        ? doc(firestore, 'hosts', hostId, TENANT_EMAIL_COLLECTION, templateKey)
        : null,
    [firestore, hostId, templateKey, editable],
  )
  const {
    data: version,
    status,
    error,
    hasPendingWrites,
  } = useFirestoreDoc<HostEmailVersionState>(
    () =>
      editable && hostId
        ? doc(
            firestore,
            'hosts',
            hostId,
            TENANT_EMAIL_COLLECTION,
            templateKey,
            'versions',
            versionId,
          )
        : null,
    [firestore, hostId, templateKey, versionId, editable],
  )
  const nodes = version?.nodes

  const saveVersion = useCallback(
    async (nextNodes: Record<string, unknown>) => {
      if (!hostId) return
      const stamp = Timestamp.now()
      await setDoc(
        doc(
          firestore,
          'hosts',
          hostId,
          TENANT_EMAIL_COLLECTION,
          templateKey,
          'versions',
          versionId,
        ),
        { templateKey, nodes: nextNodes, updatedAt: stamp },
        { merge: true },
      )
      await setDoc(
        doc(firestore, 'hosts', hostId, TENANT_EMAIL_COLLECTION, templateKey),
        {
          versionId,
          updatedAt: stamp,
          updatedByEmail: (user as { email?: string } | undefined)?.email ?? '',
        },
        { merge: true },
      )
    },
    [firestore, hostId, templateKey, versionId, user],
  )

  const {
    saveAvailable,
    remoteChanged,
    draft,
    handleSave,
    jsonOpen,
    openJsonEditor,
    closeJsonEditor,
    handleJsonSave,
    hasError,
    notFound,
  } = useBesignerDocument({
    nodes,
    updatedAt: version?.updatedAt,
    pendingWrites: hasPendingWrites,
    status: editable ? status : 'success',
    error,
    save: saveVersion,
    noun: 'email',
    viewType: Aglyn.HostViewType.EMAIL,
    documentKey: `${hostId}:${templateKey}:${versionId}`,
    draft: {
      scope: hostId,
      kind: 'email',
      docId: templateKey,
      versionId,
    },
    notify: enqueueSnackbar,
    queueLoading,
  })

  const handlePropertiesSave = useCallback(async () => {
    if (!definition || !hostId) return
    // Never write a subject seeded from a read we know is stale (AGL-1066).
    // Both fields fall back to `template?.…` — the LISTENER read — whenever
    // the author edited only one of them, and `persistentLocalCache` keeps
    // serving listeners from IndexedDB after a session goes stale. Editing the
    // subject would then write the cached preheader back over a newer one.
    //
    // The node save on this page needs no such guard: `use-besigner-document`
    // stamps and compares `updatedAt` (AGL-674), so a save from a stale read
    // is refused by the concurrency check before it can land.
    if (getSessionHealth().staleSession) {
      enqueueSnackbar(
        'Your session went stale, so this email may be out of date — saving ' +
          'now could overwrite newer changes. Sign in again and reload.',
        { variant: 'error' },
      )
      return
    }
    try {
      await setDoc(
        doc(firestore, 'hosts', hostId, TENANT_EMAIL_COLLECTION, templateKey),
        {
          subject: (subjectInput ?? template?.subject ?? '').trim(),
          preheader: (preheaderInput ?? template?.preheader ?? '').trim(),
          updatedAt: Timestamp.now(),
          updatedByEmail: (user as { email?: string } | undefined)?.email ?? '',
        },
        { merge: true },
      )
      setSubjectInput(null)
      setPreheaderInput(null)
      enqueueSnackbar('Subject and preheader saved', {
        variant: 'success',
        persist: false,
      })
    } catch (saveError) {
      enqueueSnackbar(`Error: ${(saveError as Error)?.message}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    definition,
    firestore,
    hostId,
    templateKey,
    subjectInput,
    preheaderInput,
    template,
    user,
    enqueueSnackbar,
  ])

  useEffect(() => {
    if (!editable) return
    if (hasError) {
      enqueueSnackbar(`Error: ${error?.message}`, {
        variant: 'error',
        allowDuplicate: true,
      })
    } else if (notFound) {
      enqueueSnackbar('404: Email template version not found', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [editable, enqueueSnackbar, hasError, error, notFound])

  const blocked = !definition ? (
    <Alert severity="error" sx={{ m: 3 }}>
      {`No site email is registered under "${templateKey}".`}
    </Alert>
  ) : !editable ? (
    <Alert severity="warning" sx={{ m: 3 }}>
      {`${definition.name} is not customizable here.`}
    </Alert>
  ) : null

  return (
    <BindingPickerProvider hostId={hostId}>
      {/* Host variables in the email designer (AGL-1023). This surface had no
          binding picker at all, which is the one where it matters most: a
          publisher's email template is exactly the artifact that needs to name
          the installing site rather than hard-code it. */}
      <MainLayout
        enableAppBarElevation
        besigner
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
              { type: 'divider' },
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
                icon: { path: ICON_VARIANT_MODIFY_ADD.path },
                children: 'New Element',
                onClick: () =>
                  handleAddElementClick(Besigner.focus.getLastSelected()),
              },
            ],
          },
        ]}
      >
        {blocked ??
          (error || notFound ? (
            <Stack sx={{ alignItems: 'center', justifyContent: 'center' }}>
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
                onPropertiesEdit={() => setPropertiesOpen(true)}
              />
              <BesignerDraftAlertComponent draft={draft} noun="email" />
            {remoteChanged ? (
                <Alert
                  severity="warning"
                  sx={{
                    borderRadius: 0,
                    position: 'relative',
                    zIndex: 'appBar',
                  }}
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
                  {'Someone else saved this email while you were editing. ' +
                    'Saving is paused so their work is not overwritten — ' +
                    'reload to pick up their changes.'}
                </Alert>
              ) : null}
              {/* Host emails have a host, so the media picker works here — the
                  affordance the system-email editor lacked (AGL-761). */}
              <BesignerMediaPickerProvider hostId={hostId}>
                <WorkspaceEditorComponent>
                  <ViewportRootComponent>
                    <ViewportCanvasComponent />
                  </ViewportRootComponent>
                </WorkspaceEditorComponent>
              </BesignerMediaPickerProvider>
            </>
          ))}
      </MainLayout>

      <CloseableDrawerComponent
        open={propertiesOpen}
        drawerTitle={definition ? `${definition.name} properties` : 'Properties'}
        action={'Done'}
        disableCloseButton
        onClose={() => setPropertiesOpen(false)}
        onActionClick={() => setPropertiesOpen(false)}
      >
        <Stack spacing={1} sx={{ px: 3, pb: 3 }}>
          <Typography variant="subtitle2">{'Subject'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {'What the recipient sees in their inbox. Saved on the template, ' +
              'separately from the canvas.'}
          </Typography>
          <TextField
            size="small"
            label="Subject"
            value={subjectInput ?? template?.subject ?? ''}
            onChange={(e) => setSubjectInput(e.target.value)}
            helperText={
              definition ? `Default: ${definition.defaultSubject}` : undefined
            }
          />
          <TextField
            size="small"
            label="Preheader"
            value={preheaderInput ?? template?.preheader ?? ''}
            onChange={(e) => setPreheaderInput(e.target.value)}
            helperText="The preview line most mail clients show after the subject"
          />
          <Button
            size="small"
            variant="outlined"
            onClick={() => void handlePropertiesSave()}
            disabled={subjectInput == null && preheaderInput == null}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Save subject'}
          </Button>

          <Typography variant="subtitle2" sx={{ pt: 2 }}>
            {'Merge tokens'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {(definition?.mergeTokens?.length ?? 0)
              ? 'Usable in the subject, the preheader and any text block. ' +
                'A token this email does not supply is blanked before sending.'
              : 'This email supplies no merge tokens.'}
          </Typography>
          {(definition?.mergeTokens ?? []).map((token) => (
            <Typography key={token.name} variant="caption">
              <code>{`{{${token.name}}}`}</code>
              {` — ${token.description}`}
            </Typography>
          ))}
        </Stack>
      </CloseableDrawerComponent>

      {Boolean(Aglyn.canvas.rootNode && jsonOpen) && (
        <JsonEditor
          open={Boolean(Aglyn.canvas.rootNode && jsonOpen)}
          onClose={closeJsonEditor}
          onSave={handleJsonSave}
          defaultValue={Aglyn.canvas.nestedNodes as any}
        />
      )}
    </BindingPickerProvider>
  )
}

HostEmailBesignerPage.displayName = 'Page:HostEmailBesigner'

const HostEmailBesigner = withBesignerContext(observer(HostEmailBesignerPage))

/** Gates the canvas on component registration (the blank-canvas invariant,
 * AGL-52), the same way the system-email editor does. */
function HostEmailBesignerRoute() {
  const ready = useHostEmailComponentsReady()
  if (!ready) return LOADING_OVERLAY_ELEMENT
  return <HostEmailBesigner />
}
HostEmailBesignerRoute.displayName = 'Page:HostEmailBesignerRoute'

export default HostEmailBesignerRoute
