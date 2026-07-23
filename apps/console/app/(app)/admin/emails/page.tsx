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
  SYSTEM_EMAIL_COLLECTION,
  SYSTEM_EMAIL_TEMPLATES,
  isSystemEmailEditable,
  type SystemEmailTemplateDefinition,
} from '@aglyn/shared-util-email'
import { ICON_VARIANT_SYMBOL_MAIL } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import { collection, doc, updateDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import SystemEmailTestDrawer from '../../../../components/system-email-test-drawer.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'
import { openSystemEmailVersion } from '../../../../utils/open-system-email-version'

/** Firebase's own template settings, for the rows we do not control. */
const FIREBASE_TEMPLATES_URL =
  'https://console.firebase.google.com/project/aglyn-main/authentication/emails'

interface TemplateState {
  $id: string
  versionId?: string
  updatedAt?: { toDate?: () => Date }
  updatedByEmail?: string
}

/**
 * Staff system email templates (AGL-748).
 *
 * Rows come from the code-defined catalog, **not** Firestore, so every email
 * the product sends is always listed — including ones nobody has designed a
 * template for yet. Firestore only supplies per-row state: whether a
 * template exists, and who last touched it.
 *
 * There is deliberately no create and no delete. The set of system emails is
 * whatever the product actually sends, which is a code fact.
 */
function AdminEmails() {
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const [resetting, setResetting] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  // The template whose test drawer is open, or null (AGL-766).
  const [testDefinition, setTestDefinition] =
    useState<SystemEmailTemplateDefinition | null>(null)

  const { data: templateDocs } = useFirestoreCollection<TemplateState>(
    () => collection(firestore, SYSTEM_EMAIL_COLLECTION),
    [firestore],
    { idField: '$id' },
  )
  const byKey = new Map(
    (templateDocs ?? []).map((entry) => [entry.$id, entry]),
  )

  /**
   * Opens the besigner editor (AGL-749), creating the template document and
   * a seeded first version if this email has never been designed. There is
   * no separate "create" action because the catalog is code — pressing Edit
   * on an undesigned email IS the create.
   */
  const openEditor = useCallback(
    async (definition: SystemEmailTemplateDefinition) => {
      setOpening(definition.key)
      try {
        const versionId = await openSystemEmailVersion(firestore, definition)
        router.push(
          buildRoute(Route.ADMIN_EMAIL_BESIGNER, {
            templateKey: definition.key,
            versionId,
          }),
        )
      } catch (error) {
        enqueueSnackbar(
          `Could not open ${definition.name}: ${(error as Error)?.message}`,
          { variant: 'error', allowDuplicate: true },
        )
        setOpening(null)
      }
    },
    [firestore, router, enqueueSnackbar],
  )

  const resetToDefault = useCallback(
    async (definition: SystemEmailTemplateDefinition) => {
      setResetting(definition.key)
      try {
        // Clears the pointer rather than deleting the document, so the record
        // of who changed what survives (and rules keep delete closed).
        await updateDoc(
          doc(firestore, SYSTEM_EMAIL_COLLECTION, definition.key),
          { versionId: null },
        )
        enqueueSnackbar(`${definition.name} is back to the default copy`, {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        enqueueSnackbar(
          `Could not reset ${definition.name}: ${(error as Error)?.message}`,
          { variant: 'error', allowDuplicate: true },
        )
      } finally {
        setResetting(null)
      }
    },
    [firestore, enqueueSnackbar],
  )

  return (
    <>
      <NextPageTitle screen={'System emails'} />
      <DashboardLayout
        help="staffConsole"
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_ORGS) },
          { children: 'System emails', href: buildRoute(Route.ADMIN_EMAILS) },
        ]}
        header={{
          children: 'System Emails',
          icon: { path: ICON_VARIANT_SYMBOL_MAIL.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {/* The rows come from the code-defined catalog rather than
              Firestore, so without this the whole list of mail Aglyn sends —
              internal staff alerts included — renders for anyone signed in.
              The rules deny the per-row reads either way, which is why the
              gap was invisible: the page merely looked empty. */}
          <StaffOnly>
          <Stack spacing={2}>
            <CardDisplay
              header={'System emails'}
              help={docsHelp('staffConsole')}
              subheader={
                'The mail Aglyn itself sends. Design a template to replace ' +
                'the built-in copy — the default is used until you do.'
              }
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                {SYSTEM_EMAIL_TEMPLATES.map((definition) => {
                  const stored = byKey.get(definition.key)
                  const customized = Boolean(stored?.versionId)
                  const editable = isSystemEmailEditable(definition)
                  const updatedAt = stored?.updatedAt?.toDate?.()
                  return (
                    <Stack
                      key={definition.key}
                      direction="row"
                      spacing={2}
                      sx={{
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        opacity: editable ? 1 : 0.7,
                      }}
                    >
                      <Stack spacing={0.5} sx={{ flexGrow: 1 }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center' }}
                        >
                          <Typography variant="subtitle2">
                            {definition.name}
                          </Typography>
                          {editable ? (
                            <Chip
                              size="small"
                              label={customized ? 'Customized' : 'Using default'}
                              color={customized ? 'primary' : 'default'}
                            />
                          ) : (
                            <Chip size="small" label="Sent by Firebase" />
                          )}
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {definition.description}
                        </Typography>
                        {customized && updatedAt ? (
                          <Typography variant="caption" color="text.secondary">
                            {`Last edited ${updatedAt.toLocaleString()}`}
                            {stored?.updatedByEmail
                              ? ` by ${stored.updatedByEmail}`
                              : ''}
                          </Typography>
                        ) : null}
                      </Stack>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexShrink: 0 }}
                      >
                        {editable ? (
                          <>
                            {customized ? (
                              <Button
                                size="small"
                                color="inherit"
                                disabled={resetting === definition.key}
                                onClick={() => void resetToDefault(definition)}
                              >
                                {'Reset to default'}
                              </Button>
                            ) : null}
                            <Button
                              size="small"
                              color="inherit"
                              onClick={() => setTestDefinition(definition)}
                            >
                              {'Send test'}
                            </Button>
                            <Button
                              size="small"
                              variant="contained"
                              disabled={opening === definition.key}
                              onClick={() => void openEditor(definition)}
                            >
                              {customized ? 'Edit' : 'Design'}
                            </Button>
                          </>
                        ) : (
                          <Link
                            href={FIREBASE_TEMPLATES_URL}
                            target="_blank"
                            rel="noreferrer"
                            variant="body2"
                          >
                            {'Firebase console'}
                          </Link>
                        )}
                      </Stack>
                    </Stack>
                  )
                })}
              </Stack>
            </CardDisplay>

            {/* Stated plainly rather than left for someone to discover by
                editing a template and wondering why nothing changed. */}
            <Alert severity="info">
              {'Password reset and email verification are sent by Firebase ' +
                'Auth from its own templates, so they cannot be designed ' +
                'here yet. Editing them will become possible once Aglyn ' +
                'takes over those sends (AGL-751).'}
            </Alert>

            <Typography variant="caption" color="text.secondary">
              {'Adding a new system email is a code change — this list is ' +
                'generated from the emails the product actually sends, so ' +
                'it can never advertise one that does not exist.'}
            </Typography>
          </Stack>
          </StaffOnly>
        </Container>
      </DashboardLayout>
      <SystemEmailTestDrawer
        open={Boolean(testDefinition)}
        definition={testDefinition}
        onClose={() => setTestDefinition(null)}
      />
    </>
  )
}
AdminEmails.displayName = 'Page:AdminEmails'

export default AdminEmails
