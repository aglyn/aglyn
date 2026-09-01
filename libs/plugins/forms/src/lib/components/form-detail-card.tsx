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
  buildRoute,
  PageHeaderActions,
  PageHeaderRecord,
  pluginDocsHelp,
  Route,
} from '@aglyn/aglyn'
import { ICON_VARIANT_BESIGNER } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, GridItems, MdiIcon, useLoading } from '@aglyn/shared-ui-jsx'
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
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostCampaigns,
  useHostVersionApi,
} from '@aglyn/tenant-feature-instance'
import CampaignPicker from '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component'
import { collection, doc, limit, query, updateDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import FormDesignPreview from './form-design-preview.component'
import FormMetricsCard from './form-metrics-card.component'
import FormSubmissionsCard from './form-submissions-card.component'
import useFormPromoteApi from './use-form-promote-api'

export interface FormDetailCardProps {
  hostId: string
  formId: string
  /**
   * The Forms surface's own absolute console path.
   *
   * Only the not-found branch links it. The trail carries the way back on a
   * form that exists, so a link beside the heading would be the breadcrumb
   * written twice; a form that does NOT exist has no heading of its own for
   * the trail to end on, and the reader needs somewhere to go.
   */
  basePath?: string
  /** Whether this viewer's role on the site may make a version live. */
  canPublish?: boolean
  /** False while the role is still being read; see the disabled reasons. */
  hostRoleLoaded?: boolean
}

/**
 * One form — the component detail surface, for a document that is also a
 * contract.
 *
 * The split this enforces is the reason it exists rather than sending a row
 * straight into the besigner. A form has two halves:
 *
 *  - the DESIGN, which is what an author draws, and which lives in the
 *    besigner reached from here;
 *  - the DECLARATION — where a submission is routed and which field carries
 *    marketing consent — which is edited here.
 *
 * They are edited apart because the declaration is what the design is then
 * checked AGAINST. `checkFormContract` compares the two at publish, so a
 * surface that let an author change both in one motion would let them satisfy
 * the check by moving whichever side happened to be easier — which is how a
 * form ends up with lead routing pointed at a field nobody fills in.
 *
 * ## Promotion lives here, not only in the besigner
 *
 * A component's version history offers Publish on any version: promotion is
 * how you go back, not only how you go forward, and an author restoring last
 * week's design should not have to open a canvas to do it.
 *
 * It rides `/api/hosts/forms/promote` rather than an `updateDoc` here, because
 * a form's promotion has to run `checkFormContract` on the tree it is about to
 * write and REFUSE. A check in this component would be advice a determined
 * client could skip; the route reads the stored version itself, so nothing
 * about the design crosses the wire inbound and there is no version of this
 * surface that can publish a design the check has not seen.
 */
export function FormDetailCard(props: FormDetailCardProps) {
  const { hostId, formId, basePath, canPublish, hostRoleLoaded } = props
  const firestore = useFirestore()
  const { orgSlug, subdomain: host } = useConsoleHostRoute(hostId)
  const createHostVersion = useHostVersionApi()
  const promoteForm = useFormPromoteApi()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const { data: form, status } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'forms', formId),
    [firestore, hostId, formId],
    { idField: '$id' },
  )
  // Three states, not two (AGL-706): loading and absent both arrive as
  // `undefined`, and an editable form over a mistyped id reads as data loss.
  const notFound = status !== 'loading' && !form

  /**
   * The published design, in BOTH stored forms (AGL-1151).
   *
   * The read above is converter-less, so `nodes` arrives exactly as stored —
   * msgpack for a design promoted since forms were compressed, a plain map
   * for everything older. Decoded once here because two surfaces below need
   * it and both fail silently on the raw value: `checkFormContract` reports
   * bogus violations against a tree it cannot walk, and the AGL-753 empty
   * guard passes on a `Bytes` because `Object.keys` counts the wrapper.
   */
  const formNodes = useMemo(
    () => Aglyn.decodeStoredNodes<Record<string, any>>(form?.nodes),
    [form?.nodes],
  )

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
  /**
   * The campaigns picked on screen, or null while the stored value stands.
   *
   * Null and `[]` are different: null means "not touched", `[]` means "take
   * this form out of every campaign". Collapsing them would make clearing the
   * last campaign a no-op, which is the half of set-and-clear that is easy to
   * ship broken.
   */
  const [campaignIds, setCampaignIds] = useState<string[] | null>(null)
  const [opening, setOpening] = useState(false)
  const [promoting, setPromoting] = useState<string | null>(null)
  /**
   * What a REFUSED promotion said, kept on the surface rather than in a toast.
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
  /*
   * WHICH CAMPAIGNS THIS FORM IS PART OF.
   *
   * The site's campaigns are read while this page is open because the field
   * is DISPLAYED here as well as edited here: the document stores ids, and a
   * page that drew them until a button was pressed would be showing a
   * merchant raw storage. Bounded at the ceiling the campaigns table itself
   * draws, so it can offer nothing that list does not.
   */
  const siteCampaigns = useHostCampaigns(hostId, { enabled: Boolean(form) })
  const storedCampaigns = useMemo(
    () => Aglyn.readCampaignIds(form as Record<string, unknown>),
    [form],
  )
  const effectiveCampaigns = campaignIds ?? storedCampaigns

  /**
   * What the published design would break, judged against the declaration as
   * it is being edited here.
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
            nodes: formNodes as never,
            formNodeId: findFormNodeId(formNodes as never),
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
        // An empty selection is stored as an empty array rather than removing
        // the field: one shape for "in no campaign", which is what keeps this
        // writer and the campaign's own detach agreeing.
        ...(campaignIds != null
          ? {
              [Aglyn.CAMPAIGN_MEMBERSHIP_FIELD]:
                Aglyn.campaignMembershipValue(campaignIds),
            }
          : {}),
        updatedAt: Timestamp.now(),
      })
      setName(null)
      setLead(null)
      setConsentField(null)
      setCampaignIds(null)
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
    campaignIds,
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
   * Forms adopted from a page carry a declared field list and a `nodes` map
   * seeded from the page they were adopted from — so the first version opens
   * on the form the site was ALREADY submitting rather than a blank canvas.
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
              // Emptiness, not just absence: a form that holds no `nodes` and
              // `??` would pass an empty map straight through to a version
              // that opens uneditable (AGL-753). Measured on the DECODED
              // tree — `Object.keys` over a stored `Bytes` is non-empty, so
              // the raw value passes this guard and mints exactly the
              // uneditable version it exists to stop (AGL-1151).
              nodes: Object.keys(formNodes ?? {}).length
                ? formNodes
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
        // The editor's URL needs the resolved org slug and subdomain, which
        // `useConsoleHostRoute` reads. Until they land the button below is
        // disabled, so this branch cannot be reached without them.
        if (orgSlug && host) {
          router.push(
            buildRoute(Route.FORM_BESIGNER, { orgSlug, host, formId, versionId }),
          )
        }
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

  const dirty =
    name != null ||
    lead != null ||
    consentField != null ||
    (campaignIds != null &&
      !Aglyn.campaignMembershipUnchanged(storedCampaigns, campaignIds))
  // Named before it is used on every row, so a role denial reads as a reason
  // rather than as a control that does nothing.
  const publishBlock = hostRoleLoaded
    ? 'Your role on this site can edit content but not publish it'
    : 'Checking what your role can do…'

  if (notFound) {
    return (
      <CardDisplay
        header="Form not found"
        help={pluginDocsHelp('forms', {
          anchor: '#build-a-form',
          excerpt:
            'A form is created from the Forms list and keeps the id every ' +
            'submission is filed under.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Alert severity="info">
            {`No form on this site has the id ${formId}. It may have been deleted, or the link may be from another site.`}
          </Alert>
          {basePath ? <AppLink href={basePath}>{'Back to forms'}</AppLink> : null}
        </Stack>
      </CardDisplay>
    )
  }

  /* The cards, named so the page chrome above them is a plain list of
     what this surface publishes upward. */
  const cards = (
    <GridItems
      spacing={3}
      items={[
        {
          size: { xs: 12, lg: 5 },
          children: (
            <CardDisplay
              header="Details"
              help={pluginDocsHelp('forms', {
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
                {/*
                  A FORM IS PART OF A CAMPAIGN, and may be part of several.
                  The same signup form is placed by one push and re-placed by
                  the next, so this is a multi-select — a single value would
                  make filing it under this quarter's campaign silently
                  un-file it from last quarter's.

                  It is an assignment and nothing else: it does not decide who
                  a campaign mails, and it does not credit a submission to
                  one. Attribution is recorded from the link a visitor
                  followed, on its own evidence, and it goes on saying what it
                  says whatever is picked here.
                */}
                <CampaignPicker
                  options={siteCampaigns.options}
                  value={effectiveCampaigns}
                  onChange={setCampaignIds}
                  helperText="The campaigns this form is part of. It does not change who a campaign mails."
                  empty={siteCampaigns.ready && !siteCampaigns.options.length}
                />
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
              help={pluginDocsHelp('forms', {
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
                  onChange={(event) => setConsentField(event.target.value)}
                  fullWidth
                  helperText="The one field that IS the opt-in. Submitting a form is never itself consent."
                >
                  <MenuItem value="">
                    {'None — this form collects no opt-in'}
                  </MenuItem>
                  {declaredFields.map((field) => (
                    <MenuItem key={field.fieldName} value={field.fieldName}>
                      {field.label
                        ? `${field.label} (${field.fieldName})`
                        : field.fieldName}
                    </MenuItem>
                  ))}
                </TextField>
                {violations.length ? (
                  <Alert severity="warning">
                    <AlertTitle>{'This form would stop collecting'}</AlertTitle>
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
              help={pluginDocsHelp('forms', {
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
                            {version.createdAt?.toDate?.().toLocaleString() ??
                              '--'}
                          </TableCell>
                          <TableCell>
                            {version.updatedAt?.toDate?.().toLocaleString() ??
                              '--'}
                          </TableCell>
                          <TableCell align="right">
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ justifyContent: 'flex-end' }}
                            >
                              <Button
                                size="small"
                                disabled={opening || !orgSlug || !host}
                                onClick={handleOpen(version.$id)}
                              >
                                {'Open'}
                              </Button>
                              {/*
                                The version the sites already serve has nothing
                                to promote to, so the control is disabled
                                rather than absent — an absent control and an
                                inapplicable one look identical, and only one
                                of them is honest.
                              */}
                              <Button
                                size="small"
                                variant="outlined"
                                title={canPublish ? undefined : publishBlock}
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
          /*
            THE MESSAGES THEMSELVES, under the numbers that describe them.
            Full width because it is a table of people and what they wrote,
            and it sits below the metrics because those are read at a glance
            and this is read a row at a time.
           */
          size: { xs: 12 },
          children: <FormSubmissionsCard hostId={hostId} formId={formId} />,
        },
        {
          // Full width: the frame is a document, and a document in a
          // five-column card is a column of one-word lines.
          size: { xs: 12 },
          children: (
            <CardDisplay
              header="What a submission will carry"
              help={pluginDocsHelp('forms', {
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
  )

  return (
    <>
      {/*
        The page chrome this surface cannot set for itself. The console shell
        owns the layout and builds its heading from the Forms nav item, so
        without these the page about one form is headed `Forms` and its trail
        stops on the list — the same on every row of it.
      */}
      <PageHeaderRecord
        title={form ? form.displayName || formId : undefined}
      />
      {/*
        The besigner is what this surface exists to reach, so it leads — in
        the PAGE header, which is where an action belongs on a surface with
        no section rail beneath it. Withheld when there is no form: it would
        mint a version document under an id that has none (AGL-706).
      */}
      <PageHeaderActions>
        <Button
          size="small"
          variant="contained"
          disabled={opening || !orgSlug || !host}
          title={
            orgSlug && host ? undefined : 'Resolving this site’s address…'
          }
          onClick={handleOpen()}
          startIcon={
            <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} />
          }
        >
          {opening ? 'Opening…' : 'Edit in besigner'}
        </Button>
      </PageHeaderActions>
      {cards}
    </>
  )
}
FormDetailCard.displayName = 'FormDetailCard'

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

export default FormDetailCard
