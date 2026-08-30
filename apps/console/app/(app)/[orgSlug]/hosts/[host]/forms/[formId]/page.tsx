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
import {
  ICON_VARIANT_APP_SETTINGS,
  ICON_VARIANT_BESIGNER,
} from '@aglyn/shared-data-enums'
import {
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  AlertTitle,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useFirestore, useHostVersionApi } from '@aglyn/tenant-feature-instance'
import { collection, doc, limit, query, updateDoc } from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import ArtifactNotFound from '../../../../../../../components/artifact-not-found.component'
import FormDesignPreview from '../../../../../../../components/forms/form-design-preview.component'
import FormMetricsCard from '../../../../../../../components/forms/form-metrics-card.component'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../../components/host-id-provider'
import DocumentPresenceLive from '../../../../../../../components/document-presence-live.component'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../../constants/shared'
import { docsHelp } from '../../../../../../../constants/docs-links'
import useFormPromoteApi from '../../../../../../../hooks/use-form-promote-api'
import { useOrgSlug } from '../../../../../../../hooks/use-org-scope'
import useFirestoreCollection from '../../../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../../../hooks/use-firestore-doc'
import useHostRole from '../../../../../../../hooks/use-host-role'
import { useDeclareDocumentSubject } from '../../../../../../../components/document-subject'

/**
 * Form detail — the component detail page's shape, for a document that is
 * also a contract.
 *
 * The split this page enforces is the reason it exists rather than sending a
 * row straight into the besigner. A form has two halves:
 *
 *  - the DESIGN, which is what an author draws, and which lives in the
 *    besigner reached from here;
 *  - the DECLARATION — where a submission is routed and which field carries
 *    marketing consent — which is edited here.
 *
 * They are edited apart because the declaration is what the design is then
 * checked AGAINST. `checkFormContract` compares the two at publish, so a page
 * that let an author change both in one motion would let them satisfy the
 * check by moving whichever side happened to be easier — which is how a form
 * ends up with lead routing pointed at a field nobody fills in.
 *
 * ## Promotion lives here, not only in the besigner
 *
 * A component's version history offers Publish on any version: promotion is
 * how you go back, not only how you go forward, and an author restoring last
 * week's design should not have to open a canvas to do it. Forms had no such
 * control at all — the only way to move `versionId` was to be standing in the
 * besigner on the version you wanted.
 *
 * It rides `/api/hosts/forms/promote` rather than an `updateDoc` here, because
 * a form's promotion has to run `checkFormContract` on the tree it is about to
 * write and REFUSE. A check in this component would be advice a determined
 * client could skip; the route reads the stored version itself, so nothing
 * about the design crosses the wire inbound and there is no version of this
 * page that can publish a design the check has not seen.
 */
const FormDetails: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ formId: string }>()
  const formId = params?.formId as string
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()
  const createHostVersion = useHostVersionApi()
  const promoteForm = useFormPromoteApi()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  // The `author` host role edits content and may NOT publish it (AGL-2334).
  // Disabled with a reason rather than hidden, so the console says no instead
  // of the route answering with a bare 403.
  const { canPublish, loaded: hostRoleLoaded } = useHostRole(hostId)

  const { data: form, status } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'forms', formId),
    [firestore, hostId, formId],
    { idField: '$id' },
  )
  useDeclareDocumentSubject(formId, form?.displayName)
  // Three states, not two (AGL-706): loading and absent both arrive as
  // `undefined`, and an editable form over a mistyped id reads as data loss.
  const notFound = status !== 'loading' && !form

  // No orderBy: the oldest version docs predate `createdAt`, and Firestore
  // drops documents missing the ordered field.
  const { data: versionDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'forms', formId, 'versions'),
        limit(100),
      ),
    [firestore, hostId, formId],
    { idField: '$id' },
  )
  const versions = [...(versionDocs ?? [])].sort(
    (a: any, b: any) =>
      (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
  )
  const publishedVersionId = form?.versionId as string | undefined

  const [name, setName] = useState<string | null>(null)
  const [lead, setLead] = useState<boolean | null>(null)
  const [consentField, setConsentField] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [promoting, setPromoting] = useState<string | null>(null)
  /**
   * What a REFUSED promotion said, kept on the page rather than in a toast.
   *
   * A contract violation is a list of things to go and fix in the besigner,
   * and a snackbar is gone by the time the author has read the second one.
   * The besigner's own refusal persists for the same reason.
   */
  const [promoteRefusal, setPromoteRefusal] = useState<{
    message: string
    violations: Aglyn.FormContractViolation[]
  } | null>(null)

  /** The fields the PUBLISHED design draws, which is what a submission can carry. */
  const declaredFields: Aglyn.FormFieldDecl[] = useMemo(
    () => (Array.isArray(form?.fields) ? form.fields : []),
    [form],
  )

  const effectiveLead = lead ?? form?.routing?.lead === true
  const effectiveConsent = consentField ?? String(form?.consentFieldName ?? '')

  /**
   * What the published design would break, judged against the declaration as
   * it is being edited on this page.
   *
   * Shown here as well as at publish because the two halves are edited in
   * different places: turning lead routing on for a form whose design has no
   * email field is a break the author causes HERE, on a design they are not
   * looking at, and the besigner would not tell them until they next opened
   * it.
   */
  const violations = useMemo(
    () =>
      form
        ? Aglyn.checkFormContract({
            form: {
              routing: { ...(form.routing ?? {}), lead: effectiveLead },
              ...(effectiveConsent
                ? { consentFieldName: effectiveConsent }
                : {}),
            },
            formId,
            nodes: form.nodes,
            formNodeId: findFormNodeId(form.nodes),
          })
        : [],
    [form, formId, effectiveLead, effectiveConsent],
  )

  const handleSave = useCallback(async () => {
    const dequeue = queueLoading()
    try {
      await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), {
        ...(name != null ? { displayName: name.trim() } : {}),
        ...(lead != null ? { routing: { ...(form?.routing ?? {}), lead } } : {}),
        ...(consentField != null
          ? { consentFieldName: consentField.trim() }
          : {}),
        updatedAt: Timestamp.now(),
      })
      setName(null)
      setLead(null)
      setConsentField(null)
      enqueueSnackbar('Form saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      dequeue()
    }
  }, [
    firestore,
    hostId,
    formId,
    form,
    name,
    lead,
    consentField,
    queueLoading,
    enqueueSnackbar,
  ])

  /**
   * Makes one version the version the live sites serve.
   *
   * The route decides, not this handler: it re-reads the stored version, runs
   * `checkFormContract` on the tree it is about to write, and answers 422 with
   * the violations when a publish would stop the submissions arriving. So the
   * only thing here is what to do with each answer — and a refusal is put on
   * the page rather than in a toast, because it is a list of things to fix.
   */
  const handlePromote = useCallback(
    (targetVersionId: string) => async () => {
      if (promoting) return
      setPromoting(targetVersionId)
      setPromoteRefusal(null)
      try {
        const result = await promoteForm({ hostId, formId, versionId: targetVersionId })
        if (!result.ok) {
          const message = result.message ?? 'Publish failed'
          setPromoteRefusal({
            message,
            violations: result.violations ?? [],
          })
          // `persist` because this is a refusal an author has to act on: an
          // auto-dismissed warning is how someone walks away believing the
          // form shipped.
          enqueueSnackbar(message, {
            variant: 'warning',
            allowDuplicate: true,
            persist: true,
          })
          return
        }
        enqueueSnackbar(
          'Published. The live sites now serve this version, and the form’s ' +
            'declared fields match it.',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not publish that version', {
          variant: 'error',
          allowDuplicate: true,
          persist: true,
        })
      } finally {
        setPromoting(null)
      }
    },
    [promoting, promoteForm, hostId, formId, enqueueSnackbar],
  )

  /**
   * Opens a version in the besigner, minting the first one when the form has
   * none.
   *
   * Forms adopted from a page carry a declared field list and, since the
   * design moved onto the document, a `nodes` map seeded from the page they
   * were adopted from — so the first version opens on the form the site was
   * ALREADY submitting rather than a blank canvas.
   */
  const handleOpen = useCallback(
    (targetVersionId?: string) => async () => {
      if (opening) return
      setOpening(true)
      try {
        let versionId = targetVersionId ?? publishedVersionId ?? versions[0]?.$id
        if (!versionId) {
          versionId = Aglyn.createResourceUid()
          // Rides /api/hosts/versions: rules deny the client create, and the
          // route allows a resource's FIRST version on every plan — which
          // this always is, since the form reached here with no `versionId`.
          await createHostVersion({
            hostId,
            kind: 'form',
            parentId: formId,
            id: versionId,
            data: {
              formId,
              hostId,
              displayName: 'Initial version',
              // Emptiness, not just absence: a form created before the design
              // moved onto the document holds no `nodes`, and `??` would pass
              // an empty map straight through to a version that opens
              // uneditable (AGL-753).
              nodes: Object.keys(form?.nodes ?? {}).length
                ? form.nodes
                : {
                    [Aglyn.CANVAS_ROOT_ELEMENT_ID]: {
                      $id: Aglyn.CANVAS_ROOT_ELEMENT_ID,
                      componentId: 'div',
                      nodes: [],
                    },
                  },
              ...(form?.rootId ? { rootId: form.rootId } : {}),
            },
          })
          await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), {
            versionId,
            updatedAt: Timestamp.now(),
          })
        }
        router.push(
          buildRoute(Route.FORM_BESIGNER, { orgSlug, host, formId, versionId }),
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not open the besigner', {
          variant: 'error',
          allowDuplicate: true,
        })
        setOpening(false)
      }
    },
    [
      opening,
      createHostVersion,
      publishedVersionId,
      versions,
      firestore,
      hostId,
      formId,
      form,
      router,
      orgSlug,
      host,
      enqueueSnackbar,
    ],
  )

  const listUrl = buildRoute(Route.HOST_FORMS, { orgSlug, host })
  const dirty = name != null || lead != null || consentField != null
  // Named before it is used on every row, so a role denial reads as a reason
  // rather than as a control that does nothing.
  const publishBlock = hostRoleLoaded
    ? 'Your role on this site can edit content but not publish it'
    : 'Checking what your role can do…'

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
        },
        { children: 'Forms', href: listUrl },
        {
          children: form?.displayName ?? formId,
          href: buildRoute(Route.FORM_DETAILS, { orgSlug, host, formId }),
        },
      ]}
      help={{ topic: 'forms', anchor: '#build-a-form' }}
      header={{
        children: form?.displayName ?? 'Form',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
      // The besigner is what this page exists to reach, so it belongs in the
      // hero like the component detail page's. Withheld when there is no form:
      // it would mint a version document under an id that has none (AGL-706).
      // Presence sits BESIDE the button that would join the room, and watches
      // without announcing — a page that joined on arrival would report every
      // browser as an editor.
      headerRight={
        notFound ? null : (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <DocumentPresenceLive
              hostId={hostId}
              docType="form"
              docId={formId}
              // The version Edit in besigner would actually take you to.
              versionId={publishedVersionId ?? versions[0]?.$id}
            />
            <Button
              size="small"
              variant="contained"
              disabled={opening}
              onClick={handleOpen()}
              startIcon={
                <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} />
              }
            >
              {opening ? 'Opening…' : 'Edit in besigner'}
            </Button>
          </Stack>
        )
      }
    >
      {notFound ? (
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <ArtifactNotFound
            noun="form"
            listUrl={listUrl}
            listLabel="forms"
            id={formId}
          />
        </Container>
      ) : (
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12, lg: 5 },
                children: (
                  <CardDisplay
                    header="Details"
                    help={docsHelp('forms', {
                      anchor: '#build-a-form',
                      excerpt:
                        'The id is what every submission is filed under, so ' +
                        'renaming a form never splits its history.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={2}>
                      <TextField
                        label="Display name"
                        size="small"
                        value={name ?? form?.displayName ?? ''}
                        onChange={(event) => setName(event.target.value)}
                        fullWidth
                      />
                      <Typography variant="caption" color="text.secondary">
                        {`ID ${formId} — every submission is filed under this, so it never changes`}
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="contained"
                          color="primary"
                          size="small"
                          disabled={!dirty}
                          onClick={handleSave}
                        >
                          {'Save'}
                        </Button>
                      </Stack>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, lg: 7 },
                children: (
                  <CardDisplay
                    header="Where submissions go"
                    help={docsHelp('forms', {
                      anchor: '#where-submissions-go',
                      excerpt:
                        'Every submission reaches the Inbox. Lead routing and ' +
                        'the consent field decide what else happens to it.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={2}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={effectiveLead}
                            onChange={(event) => setLead(event.target.checked)}
                          />
                        }
                        label="Create a lead from the address someone gives this form"
                      />
                      <TextField
                        select
                        label="Marketing consent field"
                        size="small"
                        value={effectiveConsent}
                        onChange={(event) =>
                          setConsentField(event.target.value)
                        }
                        fullWidth
                        helperText="The one field that IS the opt-in. Submitting a form is never itself consent."
                      >
                        <MenuItem value="">
                          {'None — this form collects no opt-in'}
                        </MenuItem>
                        {declaredFields.map((field) => (
                          <MenuItem
                            key={field.fieldName}
                            value={field.fieldName}
                          >
                            {field.label
                              ? `${field.label} (${field.fieldName})`
                              : field.fieldName}
                          </MenuItem>
                        ))}
                      </TextField>
                      {violations.length ? (
                        <Alert severity="warning">
                          <AlertTitle>
                            {'This form would stop collecting'}
                          </AlertTitle>
                          <Stack component="ul" sx={{ pl: 2, m: 0 }}>
                            {violations.map((violation) => (
                              <Typography
                                component="li"
                                variant="body2"
                                key={`${violation.code}:${violation.nodeId ?? violation.fieldName ?? ''}`}
                              >
                                {violation.message}
                              </Typography>
                            ))}
                          </Stack>
                        </Alert>
                      ) : null}
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, lg: 5 },
                children: (
                  <FormMetricsCard
                    stats={form?.stats}
                    fields={declaredFields}
                    leadRouting={effectiveLead}
                    loading={status === 'loading'}
                  />
                ),
              },
              {
                size: { xs: 12, lg: 7 },
                children: (
                  <CardDisplay
                    header="Versions"
                    help={docsHelp('forms', {
                      anchor: '#build-a-form',
                      excerpt:
                        'Publishing a form version updates every page that ' +
                        'places it. Saving does not — a save is not a publish.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={2}>
                      {promoteRefusal ? (
                        <Alert
                          severity="warning"
                          onClose={() => setPromoteRefusal(null)}
                        >
                          <AlertTitle>{promoteRefusal.message}</AlertTitle>
                          {promoteRefusal.violations.length ? (
                            <Stack component="ul" sx={{ pl: 2, m: 0 }}>
                              {promoteRefusal.violations.map((violation) => (
                                <Typography
                                  component="li"
                                  variant="body2"
                                  key={`${violation.code}:${violation.nodeId ?? violation.fieldName ?? ''}`}
                                >
                                  {violation.message}
                                </Typography>
                              ))}
                            </Stack>
                          ) : null}
                        </Alert>
                      ) : null}
                      {versions.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {'No versions yet — opening the besigner creates the first one.'}
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>{'Version'}</TableCell>
                              <TableCell>{'Created'}</TableCell>
                              <TableCell>{'Updated'}</TableCell>
                              <TableCell align="right">{'Actions'}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {versions.map((version: any) => (
                              <TableRow key={version.$id} hover>
                                <TableCell>
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    sx={{ alignItems: 'center' }}
                                  >
                                    <Typography variant="body2">
                                      {version.displayName ?? version.$id}
                                    </Typography>
                                    {version.$id === publishedVersionId ? (
                                      <Chip
                                        label="Current"
                                        color="success"
                                        size="small"
                                      />
                                    ) : null}
                                  </Stack>
                                </TableCell>
                                <TableCell>
                                  {version.createdAt
                                    ?.toDate?.()
                                    .toLocaleString() ?? '--'}
                                </TableCell>
                                <TableCell>
                                  {version.updatedAt
                                    ?.toDate?.()
                                    .toLocaleString() ?? '--'}
                                </TableCell>
                                <TableCell align="right">
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    sx={{ justifyContent: 'flex-end' }}
                                  >
                                    <Button
                                      size="small"
                                      disabled={opening}
                                      onClick={handleOpen(version.$id)}
                                    >
                                      {'Open'}
                                    </Button>
                                    {/*
                                      The version the sites already serve has
                                      nothing to promote to, so the control is
                                      disabled rather than absent — an absent
                                      control and an inapplicable one look
                                      identical, and only one of them is
                                      honest.
                                    */}
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      title={
                                        canPublish ? undefined : publishBlock
                                      }
                                      disabled={
                                        !canPublish ||
                                        promoting !== null ||
                                        version.$id === publishedVersionId
                                      }
                                      onClick={handlePromote(version.$id)}
                                    >
                                      {promoting === version.$id
                                        ? 'Publishing…'
                                        : version.$id === publishedVersionId
                                          ? 'Published'
                                          : 'Publish'}
                                    </Button>
                                  </Stack>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                // Full width: the frame is a document, and a document in a
                // five-column card is a column of one-word lines.
                size: { xs: 12 },
                children: (
                  <CardDisplay
                    header="What a submission will carry"
                    help={docsHelp('forms', {
                      anchor: '#field-types',
                      excerpt:
                        'Each field arrives under its own name. Two fields ' +
                        'sharing one name arrive as a single answer.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <FormDesignPreview
                      formId={formId}
                      nodes={form?.nodes}
                      consentFieldName={
                        effectiveConsent ? effectiveConsent : undefined
                      }
                      loading={status === 'loading'}
                    />
                  </CardDisplay>
                ),
              },
            ]}
          />
        </Container>
      )}
    </DashboardLayout>
  )
}

/**
 * The `form` node inside a published design.
 *
 * A form document's tree holds exactly one, because the document IS that
 * form — but the tree is a flat map with a synthetic root, so the node has to
 * be found rather than assumed to be the root itself.
 */
function findFormNodeId(
  nodes: Record<string, { componentId?: string }> | undefined,
): string | undefined {
  return Object.keys(nodes ?? {}).find(
    (id) => nodes?.[id]?.componentId === 'form',
  )
}

FormDetails.displayName = 'Page:FormDetails'

export default FormDetails
