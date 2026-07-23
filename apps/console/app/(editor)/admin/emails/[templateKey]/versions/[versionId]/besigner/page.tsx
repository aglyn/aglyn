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
import {
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
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  SYSTEM_EMAIL_COLLECTION,
  getSystemEmailTemplate,
  isSystemEmailEditable,
} from '@aglyn/shared-util-email'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { doc, setDoc, Timestamp } from 'firebase/firestore'
import { observer } from 'mobx-react-lite'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import BesignerAppBarComponent from '../../../../../../../../components/besigner-app-bar.component'
import MainLayout from '../../../../../../../../components/layouts/main.layout'
import '../../../../../../../../constants/app-setup'
import { consolePluginLoader } from '../../../../../../../../constants/console-plugin-loader'
import { buildRoute, Route } from '../../../../../../../../constants/route-links'
import useFirestoreDoc from '../../../../../../../../hooks/use-firestore-doc'
import { useIsStaff } from '../../../../../../../../hooks/use-is-staff'

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
 * The canvas components this editor needs, loaded without consulting an org.
 *
 * `withSitePlugins` resolves the plugin set from `useCurrentOrg()`, which is
 * exactly wrong here: a platform email belongs to no workspace, so whether
 * the signed-in staffer's current org happens to have the Email plugin
 * switched on must not decide whether the drawer has any blocks in it. The
 * one id is fixed because the EMAIL view type only ever offers email blocks;
 * the always-on `mui` bundle activates alongside it either way.
 *
 * This was two sequential `ensure` calls at first, forcing mui to register
 * before the bundle that depends on it. That was a workaround for AGL-759:
 * `ensure` activates with `Promise.all`, and the plugin manager was losing
 * the reverse-dependency edge for the FIRST dependent of any dependency, so
 * email registering ahead of mui left it permanently WAITING and the drawer
 * empty. With that fixed, either order resolves and one call is enough.
 */
function useSystemEmailComponentsReady(): boolean {
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

interface SystemEmailTemplateState {
  subject?: string
  preheader?: string
  versionId?: string
}

interface SystemEmailVersionState {
  nodes?: Aglyn.ProcessableNodes
  updatedAt?: unknown
}

/**
 * Besigner against a document with no host (AGL-749).
 *
 * Every other besigner route hangs off `hosts/{id}`, and everything they
 * carry on top of the canvas — layout chrome, SEO, password protection,
 * publishing, the live URL, the host theme, the entity/binding/interaction
 * pickers — is a property of a site. A system email has none of those. It is
 * mail the platform sends, so what is left is the canvas itself plus a
 * subject and preheader.
 *
 * That the editing core needed no changes to run here is the point: if
 * `useBesignerDocument` (AGL-746) still wanted a host, the extraction would
 * not have been real.
 *
 * Presence is deliberately absent — the `usePresence` room path is
 * `presence/{orgId}/…` and there is no honest orgId for a platform
 * document. The AGL-674 conflict detection in the shared hook still guards
 * the save, which is the part that actually protects work.
 */
function SystemEmailBesignerPage() {
  const params = useParams<{ templateKey: string; versionId: string }>()
  const templateKey = params?.templateKey as string
  const versionId = params?.versionId as string
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const handleAddElementClick = useAddElementDrawerCallback()
  const isStaff = useIsStaff()
  const listUrl = buildRoute(Route.ADMIN_EMAILS)

  const definition = getSystemEmailTemplate(templateKey)
  // A Firebase-delivered entry has an editor that could never change what a
  // recipient sees (AGL-751), so it is refused rather than opened.
  const editable = Boolean(definition && isSystemEmailEditable(definition))

  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [subjectInput, setSubjectInput] = useState<string | null>(null)
  const [preheaderInput, setPreheaderInput] = useState<string | null>(null)

  const { data: template } = useFirestoreDoc<SystemEmailTemplateState>(
    () =>
      editable ? doc(firestore, SYSTEM_EMAIL_COLLECTION, templateKey) : null,
    [firestore, templateKey, editable],
  )
  const {
    data: version,
    status,
    error,
  } = useFirestoreDoc<SystemEmailVersionState>(
    () =>
      editable
        ? doc(
            firestore,
            SYSTEM_EMAIL_COLLECTION,
            templateKey,
            'versions',
            versionId,
          )
        : null,
    [firestore, templateKey, versionId, editable],
  )
  const nodes = version?.nodes

  const saveVersion = useCallback(
    async (nextNodes: Record<string, unknown>) => {
      // Client clock, matching every other version writer (AGL-674): the
      // conflict guard compares stamps for equality, never ordering, and a
      // `serverTimestamp()` sentinel reads back as null on the local
      // snapshot before it resolves — a stamp the guard cannot use.
      const stamp = Timestamp.now()
      await setDoc(
        doc(
          firestore,
          SYSTEM_EMAIL_COLLECTION,
          templateKey,
          'versions',
          versionId,
        ),
        { templateKey, nodes: nextNodes, updatedAt: stamp },
        { merge: true },
      )
      // Re-point the template at this version on every save, not just the
      // first. "Reset to default" nulls the pointer (AGL-748), and a staffer
      // who resets and then saves again plainly means to publish what they
      // are looking at — leaving the pointer null would show a saved design
      // that no recipient ever gets.
      await setDoc(
        doc(firestore, SYSTEM_EMAIL_COLLECTION, templateKey),
        {
          versionId,
          updatedAt: stamp,
          updatedByEmail: (user as { email?: string } | undefined)?.email ?? '',
        },
        { merge: true },
      )
    },
    [firestore, templateKey, versionId, user],
  )

  const {
    saveAvailable,
    remoteChanged,
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
    // A refused template never builds a document ref, so `useFirestoreDoc`
    // reports 'loading' forever — and the shared hook turns that into a
    // loading overlay that would sit on top of the refusal message with no
    // way to dismiss it. Report the document as settled instead; `blocked`
    // renders in place of the canvas either way.
    status: editable ? status : 'success',
    error,
    save: saveVersion,
    noun: 'email',
    // Same restriction as a `kind: 'email'` screen (AGL-395): the drawer
    // offers email-safe blocks only, because this output goes through a mail
    // client, not a browser.
    viewType: Aglyn.HostViewType.EMAIL,
    documentKey: `${templateKey}:${versionId}`,
    notify: enqueueSnackbar,
    queueLoading,
  })

  const handlePropertiesSave = useCallback(async () => {
    if (!definition) return
    try {
      await setDoc(
        doc(firestore, SYSTEM_EMAIL_COLLECTION, templateKey),
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

  const blocked =
    isStaff === false ? (
      <Alert severity="warning" sx={{ m: 3 }}>
        {'Staff only. Grant access with tools/scripts/set-staff-claim.mjs, ' +
          'then sign out and back in to refresh the claim.'}
      </Alert>
    ) : !definition ? (
      <Alert severity="error" sx={{ m: 3 }}>
        {`No system email is registered under "${templateKey}". The catalog ` +
          'is code — an email that is not in it does not exist.'}
      </Alert>
    ) : !editable ? (
      <Alert severity="warning" sx={{ m: 3 }}>
        {`${definition.name} is sent by Firebase Auth from its own template, ` +
          'so designing it here would change nothing a recipient sees ' +
          '(AGL-751).'}
      </Alert>
    ) : null

  return (
    <>
      <MainLayout
        title={'Besigner'}
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
        <NextPageTitle screen={'System Email Besigner'} />

        {blocked ??
          (isStaff === null ? null : error || notFound ? (
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
          ))}
      </MainLayout>

      {/* Not `PropertiesDialogComponent`: that one hard-codes the screen SEO
          form, which is meaningless for mail. Subject and preheader are the
          only two properties a system email has, and they live on the
          template document rather than the version so resetting a design
          does not also wipe the subject line. */}
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
              definition
                ? `Default: ${definition.defaultSubject}`
                : undefined
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
            {definition?.mergeTokens.length
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
    </>
  )
}

SystemEmailBesignerPage.displayName = 'Page:SystemEmailBesigner'

const SystemEmailBesigner = withBesignerContext(observer(SystemEmailBesignerPage))

/**
 * Gates the canvas on component registration rather than wrapping with
 * `withSitePlugins`, which would resolve the plugin set from the current
 * org (the blank-canvas invariant, AGL-52).
 */
function SystemEmailBesignerRoute() {
  const ready = useSystemEmailComponentsReady()
  if (!ready) return LOADING_OVERLAY_ELEMENT
  return <SystemEmailBesigner />
}
SystemEmailBesignerRoute.displayName = 'Page:SystemEmailBesignerRoute'

export default SystemEmailBesignerRoute
