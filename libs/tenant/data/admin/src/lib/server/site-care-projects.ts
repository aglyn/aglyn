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

import {
  historyRow,
  requireHistoryReason,
  type AppendOnlyHistoryRow,
  type HistoryStripeRef,
} from '@aglyn/aglyn/app-utils/append-only-history'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  OWNER_APPROVAL_CHANNEL_WORDS,
  readOwnerApprovalInput,
} from '@aglyn/aglyn/app-utils/owner-approval-record'
import {
  formatSiteCareDate,
  formatSiteCareUsd,
  SITE_CARE_TIME_ZONE,
} from '@aglyn/aglyn/app-utils/site-care'
import {
  latestSiteCareProjectInvoice,
  readSiteCareProject,
  readSiteCareProjectScope,
  readSiteCareProjectTitle,
  SITE_CARE_PROJECT_INVOICE_DAYS_UNTIL_DUE,
  SITE_CARE_PROJECT_MAX_HOURS,
  siteCareProjectAcceptanceIsCurrent,
  siteCareProjectAcceptanceSentence,
  siteCareProjectInvoiceDescription,
  siteCareProjectInvoiceMemo,
  siteCareProjectInvoiceWords,
  siteCareProjectNextInvoice,
  siteCareProjectQuote,
  siteCareProjectQuoteIsEditable,
  siteCareProjectSplitSentence,
  siteCareProjectStatus,
  type SiteCareProject,
  type SiteCareProjectAcceptance,
  type SiteCareProjectInvoice,
  type SiteCareProjectInvoiceStatus,
} from '@aglyn/aglyn/app-utils/site-care-project'
import {
  SITE_CARE_PROJECT_ACCEPTANCE_EMAIL_KEY,
  SITE_CARE_PROJECT_INVOICE_EMAIL_KEY,
  SITE_CARE_PROJECT_PAID_EMAIL_KEY,
  SITE_CARE_PROJECT_REVERSED_EMAIL_KEY,
} from '@aglyn/shared-util-email'
import { FieldValue } from 'firebase-admin/firestore'
import {
  appendHistoryRow,
  commitHistoryRow,
  readHistoryRows,
  type HistoryAudit,
} from './append-only-history-write'
import { readOrgBilling } from './org-billing'
import { sendSiteCareEmail, type SiteCareEmailResult } from './site-care-emails'
import {
  createProjectInvoice,
  readProjectInvoice,
  SITE_CARE_PROJECT_METADATA_KEY,
  voidProjectInvoice,
} from './site-care-project-stripe'
import {
  readSiteCareOrg,
  SITE_CARE_HISTORY_COLLECTION,
  SiteCareError,
  siteCareOwnerEmail,
  type SiteCareActor,
  type SiteCareDeps,
} from './site-care-requests'
import { creditExtraTimeItem, siteCareExtraTimeProduct } from './site-care-stripe'

/**
 * SITE CARE PROJECTS, WITH FIRESTORE AND STRIPE (AGL-3970).
 *
 * The staff "Charge for work": a flat-quoted project on the org
 * (`orgs/{orgId}/siteCareProjects/{id}`) holding the scope, the quote, the
 * owner's recorded yes, every invoice it raised and the launch, with an
 * append-only history beside it (`…/siteCareProjects/{id}/siteCareHistory`).
 * None of it is in the Firestore rules: every read and write passes the
 * console's routes, as Site Care requests do.
 *
 * The same discipline as Site Care extra time, from the same modules:
 * every change writes its history row in the same batch or transaction as
 * the change, and a staff member's change writes its `adminAudit` row there
 * too. Money moves in two steps around the Stripe calls — a `creating`
 * invoice and its `invoice.requested` row commit first, then the calls under
 * the invoice's own idempotency key, then the result and its row together —
 * so a success with no row behind it is a `creating` invoice the
 * reconciliation reports and a retry adopts. Reversals write their intent
 * row before the call, keyed by the invoice's own key.
 *
 * The arithmetic is `@aglyn/aglyn/app-utils/site-care-project`, the yes
 * `owner-approval-record`, the row `append-only-history`, the Stripe calls
 * `site-care-project-stripe.ts`.
 */

export const SITE_CARE_PROJECTS_COLLECTION = 'siteCareProjects'

function projectRef(firestore: FirebaseFirestore.Firestore, orgId: string, projectId: string) {
  return firestore.collection('orgs').doc(orgId).collection(SITE_CARE_PROJECTS_COLLECTION).doc(projectId)
}

function projectHistory(firestore: FirebaseFirestore.Firestore, orgId: string, projectId: string) {
  return projectRef(firestore, orgId, projectId).collection(SITE_CARE_HISTORY_COLLECTION)
}

function projectAudit(orgId: string, projectId: string, action: string): HistoryAudit {
  return {
    action: `siteCareProject.${action}`,
    scope: 'siteCare',
    target: `orgs/${orgId}/${SITE_CARE_PROJECTS_COLLECTION}/${projectId}`,
  }
}

const nowOf = (deps: SiteCareDeps) => (deps.now ?? Date.now)()
const emailOf = (deps: SiteCareDeps) => deps.email ?? sendSiteCareEmail

/** The project as it is stored: every field, its status recomputed. */
function projectDoc(project: SiteCareProject): Record<string, unknown> {
  return {
    ...project,
    status: siteCareProjectStatus(project),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

function loadedProject(snapshot: FirebaseFirestore.DocumentSnapshot): SiteCareProject {
  const data = snapshot.exists ? snapshot.data() : null
  if (!data) throw new SiteCareError('Unknown project', 404)
  const project = readSiteCareProject(data)
  if (!project) throw new SiteCareError('That project record is unreadable', 409)
  return project
}

function findInvoice(project: SiteCareProject, seq: number): SiteCareProjectInvoice {
  const invoice = project.invoices.find((row) => row.seq === seq)
  if (!invoice) throw new SiteCareError('Unknown invoice on this project', 404)
  return invoice
}

function withInvoice(project: SiteCareProject, next: SiteCareProjectInvoice): SiteCareProject {
  return { ...project, invoices: project.invoices.map((row) => (row.seq === next.seq ? next : row)) }
}

function invoiceStripeRef(invoice: SiteCareProjectInvoice): HistoryStripeRef | null {
  return invoice.invoiceId ? { object: 'invoice', id: invoice.invoiceId, amountCents: invoice.totalCents || invoice.amountCents } : null
}

/** "Nov 2, 2026". */
function formatSiteCareDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: SITE_CARE_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Records an email as the project's history row. Never throws. */
async function recordProjectEmail(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  projectId: string,
  result: SiteCareEmailResult,
  what: string,
  atMs: number,
): Promise<void> {
  await commitHistoryRow(
    firestore,
    projectHistory(firestore, orgId, projectId),
    historyRow({
      atMs,
      by: { uid: null, email: null },
      kind: result.sent ? 'email.sent' : 'email.notSent',
      summary: result.sent
        ? `Emailed ${what} to ${result.to}.`
        : `The ${what} email was not sent${result.to ? ` to ${result.to}` : ''} (${result.reason ?? 'unknown'}).`,
      after: { subject: result.subject, to: result.to, sent: result.sent },
      subjectId: projectId,
    }),
  ).catch((error) => console.error('[site-care-projects] email history row failed', error))
}

/** Emails the owner, in the workspace's brand, and records it on the project. */
async function emailOwner(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    projectId: string
    key: string
    what: string
    merge: Record<string, string>
    fallback: { subject: string; text: string }
  },
  deps: SiteCareDeps,
): Promise<SiteCareEmailResult> {
  const org = await readSiteCareOrg(firestore, input.orgId)
  const to = await siteCareOwnerEmail(firestore, input.orgId, org)
  const result = await emailOf(deps)({
    key: input.key,
    to,
    org,
    requestId: null,
    merge: input.merge,
    fallback: input.fallback,
  })
  await recordProjectEmail(firestore, input.orgId, input.projectId, result, input.what, nowOf(deps))
  return result
}

function scopeText(project: Pick<SiteCareProject, 'scope'>): string {
  return project.scope.map((line) => `- ${line}`).join('\n')
}

// ── Quote ───────────────────────────────────────────────────────────────────

export interface SiteCareProjectQuoteInput {
  title: unknown
  scope: unknown
  kind: unknown
  estimatedHours: unknown
  /** A price above the computed one; blank means the computed one. */
  priceUsd?: unknown
}

function readQuoteInput(input: SiteCareProjectQuoteInput) {
  const title = readSiteCareProjectTitle(input.title)
  if (title.ok === false) throw new SiteCareError(title.error, 400)
  const scope = readSiteCareProjectScope(input.scope)
  if (scope.ok === false) throw new SiteCareError(scope.error, 400)
  const quote = siteCareProjectQuote({ kind: input.kind, estimatedHours: input.estimatedHours, priceUsd: input.priceUsd })
  if (quote.ok === false) throw new SiteCareError(quote.error, 400)
  return { title: title.title, scope: scope.scope, quote: quote.quote }
}

/** Quotes a project on a workspace. Nothing bills until the owner's yes is recorded. */
export async function createSiteCareProject(
  firestore: FirebaseFirestore.Firestore,
  input: SiteCareProjectQuoteInput & { orgId: string; actor: SiteCareActor },
  deps: SiteCareDeps = {},
): Promise<{ projectId: string; project: SiteCareProject }> {
  if (!input.orgId) throw new SiteCareError('Missing orgId', 400)
  const { title, scope, quote } = readQuoteInput(input)
  const org = await firestore.collection('orgs').doc(input.orgId).get()
  if (!org.exists) throw new SiteCareError('Unknown workspace', 404)
  const nowMs = nowOf(deps)
  // Minted once, before the write: every invoice's Stripe idempotency key is
  // built from this id, so it is fixed for the life of the project.
  const ref = firestore
    .collection('orgs')
    .doc(input.orgId)
    .collection(SITE_CARE_PROJECTS_COLLECTION)
    .doc(createResourceUid())
  const project: SiteCareProject = {
    orgId: input.orgId,
    title,
    scope,
    quote,
    quoteVersion: 1,
    acceptance: null,
    invoices: [],
    invoiceSeq: 0,
    firstInvoiceSentAtMs: null,
    launchedAtMs: null,
    launchedByUid: null,
    status: 'quoted',
    createdAtMs: nowMs,
    createdByUid: input.actor.uid,
    createdByEmail: input.actor.email,
    updatedAtMs: nowMs,
  }
  const batch = firestore.batch()
  batch.create(ref, { ...projectDoc(project), createdAt: FieldValue.serverTimestamp() })
  appendHistoryRow(
    batch,
    firestore,
    ref.collection(SITE_CARE_HISTORY_COLLECTION),
    historyRow({
      atMs: nowMs,
      by: input.actor,
      kind: 'project.quoted',
      summary: `Quoted “${title}”: ${siteCareProjectSplitSentence(quote)}`,
      after: { title, scope, quote: { ...quote } },
      subjectId: ref.id,
    }),
    projectAudit(input.orgId, ref.id, 'quoted'),
  )
  await batch.commit()
  return { projectId: ref.id, project }
}

/**
 * Changes a project's name, scope or price, with a reason — only until the
 * first invoice is sent. Any change is a new quote version, so a yes the
 * owner gave to the old one no longer invoices anything.
 */
export async function editSiteCareProject(
  firestore: FirebaseFirestore.Firestore,
  input: SiteCareProjectQuoteInput & { orgId: string; projectId: string; actor: SiteCareActor; reason: unknown },
  deps: SiteCareDeps = {},
): Promise<SiteCareProject> {
  const reason = requireHistoryReason(input.reason)
  if (reason.ok === false) throw new SiteCareError(reason.error, 400)
  const { title, scope, quote } = readQuoteInput(input)
  const nowMs = nowOf(deps)
  return firestore.runTransaction(async (tx) => {
    const ref = projectRef(firestore, input.orgId, input.projectId)
    const project = loadedProject(await tx.get(ref))
    if (!siteCareProjectQuoteIsEditable(project)) {
      throw new SiteCareError(
        'The first invoice is sent, so the quote is fixed. Void or credit an invoice from the project, and quote a new project for a new price.',
        409,
      )
    }
    const changed =
      title !== project.title ||
      scope.join('\n') !== project.scope.join('\n') ||
      quote.kind !== project.quote.kind ||
      quote.estimatedHours !== project.quote.estimatedHours ||
      quote.priceUsd !== project.quote.priceUsd
    if (!changed) throw new SiteCareError('Nothing changed.', 400)
    const next: SiteCareProject = {
      ...project,
      title,
      scope,
      quote,
      quoteVersion: project.quoteVersion + 1,
      updatedAtMs: nowMs,
    }
    tx.set(ref, projectDoc(next))
    const priceMoved = quote.priceUsd !== project.quote.priceUsd
    appendHistoryRow(
      tx,
      firestore,
      projectHistory(firestore, input.orgId, input.projectId),
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: 'quote.corrected',
        summary:
          (priceMoved
            ? `Changed the quote from ${formatSiteCareUsd(project.quote.priceUsd * 100)} to ${formatSiteCareUsd(quote.priceUsd * 100)}.`
            : 'Changed the quote’s name or scope; the price is the same.') +
          (project.acceptance ? ' The owner’s yes must be recorded again for this quote.' : ''),
        reason: reason.reason,
        before: { title: project.title, scope: project.scope, quote: { ...project.quote }, quoteVersion: project.quoteVersion },
        after: { title, scope, quote: { ...quote }, quoteVersion: next.quoteVersion },
        subjectId: input.projectId,
      }),
      projectAudit(input.orgId, input.projectId, 'quote.corrected'),
    )
    return next
  })
}

// ── The owner's yes ─────────────────────────────────────────────────────────

/**
 * Records — or corrects — how and when the owner accepted the quote as it
 * stands, and emails them the confirmation of the scope and price that is
 * the written record. Nothing is invoiced before this.
 */
export async function recordSiteCareProjectAcceptance(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; projectId: string; actor: SiteCareActor & { uid: string }; acceptance: Record<string, unknown> },
  deps: SiteCareDeps = {},
): Promise<SiteCareProjectAcceptance> {
  const nowMs = nowOf(deps)
  const { project, record, previous } = await firestore.runTransaction(async (tx) => {
    const ref = projectRef(firestore, input.orgId, input.projectId)
    const project = loadedProject(await tx.get(ref))
    // A correction is of a yes to THIS quote; a yes to an older quote is
    // replaced by a new one, which needs no reason — the quote changed.
    const previous = siteCareProjectAcceptanceIsCurrent(project) ? project.acceptance : null
    const read = readOwnerApprovalInput(
      { ...input.acceptance, hours: project.quote.billedHours },
      {
        rateUsd: project.quote.rateUsd,
        nowMs,
        by: { uid: input.actor.uid, email: input.actor.email },
        previous,
        maxHours: SITE_CARE_PROJECT_MAX_HOURS,
      },
    )
    if (read.ok === false) throw new SiteCareError(read.error, 400)
    const record: SiteCareProjectAcceptance = {
      ...read.record,
      ...(previous || !project.acceptance ? {} : { version: project.acceptance.version + 1 }),
      quoteVersion: project.quoteVersion,
      priceUsd: project.quote.priceUsd,
    }
    const next: SiteCareProject = { ...project, acceptance: record, updatedAtMs: nowMs }
    tx.set(ref, projectDoc(next))
    appendHistoryRow(
      tx,
      firestore,
      projectHistory(firestore, input.orgId, input.projectId),
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: previous ? 'acceptance.corrected' : 'acceptance.recorded',
        summary: previous
          ? `Corrected how the owner accepted the quote: ${OWNER_APPROVAL_CHANNEL_WORDS[record.channel]} on ${formatSiteCareDate(record.approvedAtMs)}.`
          : siteCareProjectAcceptanceSentence(record, project, formatSiteCareDate),
        reason: record.correctionReason,
        before: previous ? { ...previous } : null,
        after: { ...record },
        subjectId: input.projectId,
      }),
      projectAudit(input.orgId, input.projectId, previous ? 'acceptance.corrected' : 'acceptance.recorded'),
    )
    return { project: next, record, previous }
  })
  const sentence = siteCareProjectAcceptanceSentence(record, project, formatSiteCareDate)
  const correction = previous ? `This corrects the earlier record: ${record.correctionReason}` : ''
  const heading = previous ? 'Corrected: the quote you accepted' : 'You accepted our quote'
  await emailOwner(
    firestore,
    {
      orgId: input.orgId,
      projectId: input.projectId,
      key: SITE_CARE_PROJECT_ACCEPTANCE_EMAIL_KEY,
      what: previous ? 'the corrected acceptance confirmation' : 'the acceptance confirmation',
      merge: {
        'project.title': project.title,
        'project.scope': scopeText(project),
        'acceptance.heading': heading,
        'acceptance.sentence': sentence,
        'acceptance.correction': correction,
      },
      fallback: {
        subject: `${heading}: ${project.title}`,
        text: `${sentence} ${correction}\n\nWhat it covers:\n${scopeText(project)}\n\nIf this is not what you agreed to, reply to this email before you pay.`,
      },
    },
    deps,
  )
  return record
}

// ── Invoices ────────────────────────────────────────────────────────────────

function invoiceKey(projectId: string, seq: number): string {
  return `site-care-project:${projectId}:invoice:${seq}`
}

/** Writes a `creating` invoice and its intent row, under the rules of `siteCareProjectNextInvoice`. */
async function raiseInvoice(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; projectId: string; actor: SiteCareActor },
  deps: SiteCareDeps,
  prepare?: (project: SiteCareProject, nowMs: number) => { project: SiteCareProject; row: AppendOnlyHistoryRow; audit: HistoryAudit } | null,
): Promise<number> {
  const nowMs = nowOf(deps)
  return firestore.runTransaction(async (tx) => {
    const ref = projectRef(firestore, input.orgId, input.projectId)
    let project = loadedProject(await tx.get(ref))
    const history = projectHistory(firestore, input.orgId, input.projectId)
    const prepared = prepare ? prepare(project, nowMs) : null
    if (prepared) project = prepared.project
    const next = siteCareProjectNextInvoice(project)
    if (next.ok === false) throw new SiteCareError(next.error, 409)
    const seq = project.invoiceSeq + 1
    const invoice: SiteCareProjectInvoice = {
      seq,
      kind: next.kind,
      status: 'creating',
      amountCents: next.amountCents,
      description: siteCareProjectInvoiceDescription(project, next.kind),
      idempotencyKey: invoiceKey(input.projectId, seq),
      invoiceId: null,
      invoiceItemId: null,
      number: null,
      hostedInvoiceUrl: null,
      totalCents: 0,
      amountPaidCents: 0,
      creditNoteId: null,
      refundId: null,
      error: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      paidAtMs: null,
    }
    const updated: SiteCareProject = {
      ...project,
      invoices: [...project.invoices, invoice],
      invoiceSeq: seq,
      updatedAtMs: nowMs,
    }
    tx.set(ref, projectDoc(updated))
    if (prepared) appendHistoryRow(tx, firestore, history, prepared.row, prepared.audit)
    appendHistoryRow(
      tx,
      firestore,
      history,
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: 'invoice.requested',
        summary: `Raising the ${siteCareProjectInvoiceWords(invoice.kind)} invoice: ${formatSiteCareUsd(invoice.amountCents)} plus tax.`,
        after: { seq, kind: invoice.kind, amountCents: invoice.amountCents, idempotencyKey: invoice.idempotencyKey },
        subjectId: input.projectId,
      }),
      projectAudit(input.orgId, input.projectId, 'invoice.requested'),
    )
    return seq
  })
}

/** Emails the owner one invoice's pay link. */
async function emailInvoice(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; projectId: string; project: SiteCareProject; invoice: SiteCareProjectInvoice; resent?: boolean },
  deps: SiteCareDeps,
): Promise<SiteCareEmailResult> {
  const { project, invoice } = input
  const words = siteCareProjectInvoiceWords(invoice.kind)
  const heading = invoice.kind === 'full' ? 'Your invoice' : `Your ${words} invoice`
  const amount = formatSiteCareUsd(invoice.amountCents)
  const sentence =
    invoice.kind === 'deposit'
      ? `This is the deposit for “${project.title}”: ${amount}, half of the quote. We start work once it is paid, and invoice the other half when the project launches.`
      : invoice.kind === 'final'
        ? `“${project.title}” is live. This is the balance: ${amount}, the second half of the quote.`
        : `This is the ${amount} for “${project.title}”, in full. We start work once it is paid.`
  const due = formatSiteCareDay(invoice.createdAtMs + SITE_CARE_PROJECT_INVOICE_DAYS_UNTIL_DUE * 86_400_000)
  const total = formatSiteCareUsd(invoice.totalCents || invoice.amountCents)
  return emailOwner(
    firestore,
    {
      orgId: input.orgId,
      projectId: input.projectId,
      key: SITE_CARE_PROJECT_INVOICE_EMAIL_KEY,
      what: `${input.resent ? 'the pay link again for ' : 'the pay link for '}the ${words} invoice`,
      merge: {
        'project.title': project.title,
        'project.scope': scopeText(project),
        'invoice.heading': heading,
        'invoice.sentence': `${sentence} Tax is included in the total.`,
        'invoice.amount': total,
        'invoice.number': invoice.number ?? '',
        'invoice.due': due,
        'invoice.payUrl': invoice.hostedInvoiceUrl ?? '',
      },
      fallback: {
        subject: `${heading}: ${project.title}`,
        text: `${sentence}\n\nAmount: ${total}\nDue: ${due}\nPay here: ${invoice.hostedInvoiceUrl ?? ''}`,
      },
    },
    deps,
  )
}

/**
 * Makes the Stripe invoice for a `creating` (or `failed`) record and writes
 * the outcome; on success, emails the owner the pay link.
 */
async function settleInvoice(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; projectId: string; seq: number; actor: SiteCareActor },
  deps: SiteCareDeps,
): Promise<SiteCareProjectInvoice> {
  const project = loadedProject(await projectRef(firestore, input.orgId, input.projectId).get())
  const invoice = findInvoice(project, input.seq)
  if (invoice.status !== 'creating' && invoice.status !== 'failed') return invoice
  const billing = await readOrgBilling(input.orgId)
  const customerId = String((billing as { stripeCustomerId?: unknown }).stripeCustomerId ?? '')
  const product = customerId
    ? await siteCareExtraTimeProduct(deps.stripe)
    : ({ ok: false, error: 'The workspace has no Stripe customer to invoice.' } as const)
  const created = product.ok
    ? await createProjectInvoice(
        {
          customerId,
          productId: product.productId,
          orgId: input.orgId,
          projectId: input.projectId,
          seq: invoice.seq,
          kind: invoice.kind,
          amountCents: invoice.amountCents,
          description: invoice.description,
          memo: siteCareProjectInvoiceMemo(project),
          idempotencyKey: invoice.idempotencyKey,
          invoiceId: invoice.invoiceId,
          sinceMs: project.createdAtMs,
        },
        deps.stripe,
      )
    : null
  const nowMs = nowOf(deps)
  let next: SiteCareProjectInvoice
  if (created && created.ok) {
    const state = created.state
    next = {
      ...invoice,
      status: state.status === 'paid' ? 'paid' : 'open',
      invoiceId: state.invoiceId,
      invoiceItemId: state.invoiceItemId ?? invoice.invoiceItemId,
      number: state.number,
      hostedInvoiceUrl: state.hostedInvoiceUrl,
      totalCents: state.totalCents,
      amountPaidCents: state.amountPaidCents,
      error: null,
      updatedAtMs: nowMs,
      paidAtMs: state.status === 'paid' ? nowMs : null,
    }
  } else {
    const error = product.ok === false ? product.error : created && created.ok === false ? created.error : 'Unknown failure'
    const madeId = created && created.ok === false && 'invoiceId' in created ? (created.invoiceId ?? null) : null
    next = { ...invoice, status: 'failed', invoiceId: madeId ?? invoice.invoiceId, error, updatedAtMs: nowMs }
  }
  const saved = await firestore.runTransaction(async (tx) => {
    const ref = projectRef(firestore, input.orgId, input.projectId)
    const current = loadedProject(await tx.get(ref))
    const sent = next.status === 'open' || next.status === 'paid'
    const updated: SiteCareProject = {
      ...withInvoice(current, next),
      firstInvoiceSentAtMs: current.firstInvoiceSentAtMs ?? (sent ? nowMs : null),
      updatedAtMs: nowMs,
    }
    tx.set(ref, projectDoc(updated))
    const words = siteCareProjectInvoiceWords(next.kind)
    appendHistoryRow(
      tx,
      firestore,
      projectHistory(firestore, input.orgId, input.projectId),
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: sent ? 'invoice.sent' : 'invoice.failed',
        summary: sent
          ? `Sent the ${words} invoice${next.number ? ` ${next.number}` : ''}: ${formatSiteCareUsd(next.totalCents || next.amountCents)} with tax.`
          : `The ${words} invoice could not be made: ${next.error}`,
        after: {
          seq: next.seq,
          status: next.status,
          invoiceId: next.invoiceId,
          number: next.number,
          totalCents: next.totalCents,
          error: next.error,
        },
        stripe: sent ? invoiceStripeRef(next) : null,
        subjectId: input.projectId,
      }),
      projectAudit(input.orgId, input.projectId, sent ? 'invoice.sent' : 'invoice.failed'),
    )
    return updated
  })
  if (next.status === 'open' || next.status === 'paid') {
    await emailInvoice(firestore, { orgId: input.orgId, projectId: input.projectId, project: saved, invoice: next }, deps)
  }
  return next
}

/**
 * Raises the project's next invoice — the whole price, or the deposit —
 * on the owner's current yes, and emails them the pay link.
 */
export async function sendSiteCareProjectInvoice(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; projectId: string; actor: SiteCareActor },
  deps: SiteCareDeps = {},
): Promise<SiteCareProjectInvoice> {
  const seq = await raiseInvoice(firestore, input, deps)
  return settleInvoice(firestore, { ...input, seq }, deps)
}

/** Re-runs an invoice that failed, or whose result never landed, under its own key. */
export async function retrySiteCareProjectInvoice(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; projectId: string; seq: number; actor: SiteCareActor },
  deps: SiteCareDeps = {},
): Promise<SiteCareProjectInvoice> {
  const project = loadedProject(await projectRef(firestore, input.orgId, input.projectId).get())
  const status = findInvoice(project, input.seq).status
  if (status !== 'failed' && status !== 'creating') {
    throw new SiteCareError('That invoice is not waiting to be retried.', 409)
  }
  return settleInvoice(firestore, input, deps)
}

/** Emails the owner an open invoice's pay link again. */
export async function resendSiteCareProjectInvoice(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; projectId: string; seq: number; actor: SiteCareActor },
  deps: SiteCareDeps = {},
): Promise<SiteCareEmailResult> {
  const project = loadedProject(await projectRef(firestore, input.orgId, input.projectId).get())
  const invoice = findInvoice(project, input.seq)
  if (invoice.status !== 'open' || !invoice.hostedInvoiceUrl) {
    throw new SiteCareError('Only an unpaid invoice’s pay link is sent again.', 409)
  }
  return emailInvoice(firestore, { orgId: input.orgId, projectId: input.projectId, project, invoice, resent: true }, deps)
}

/**
 * Marks the project launched. A half-and-half project raises its balance
 * invoice from the same record, in the same step, and emails the pay link.
 * Launch comes after the first invoice is paid: both splits are paid up
 * front before work starts.
 */
export async function launchSiteCareProject(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; projectId: string; actor: SiteCareActor },
  deps: SiteCareDeps = {},
): Promise<{ project: SiteCareProject; invoice: SiteCareProjectInvoice | null }> {
  const markLaunched = (project: SiteCareProject, nowMs: number) => {
    if (project.launchedAtMs) throw new SiteCareError('This project is already marked launched.', 409)
    const first = latestSiteCareProjectInvoice(project, project.quote.split === 'full' ? 'full' : 'deposit')
    if (first?.status !== 'paid') {
      throw new SiteCareError(
        project.quote.split === 'full'
          ? 'Mark it launched once the invoice is paid.'
          : 'Mark it launched once the deposit is paid.',
        409,
      )
    }
    return {
      project: { ...project, launchedAtMs: nowMs, launchedByUid: input.actor.uid, updatedAtMs: nowMs },
      row: historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: 'project.launched',
        summary:
          project.quote.split === 'half'
            ? `Marked “${project.title}” launched; the balance is invoiced now.`
            : `Marked “${project.title}” launched.`,
        after: { launchedAtMs: nowMs },
        subjectId: input.projectId,
      }),
      audit: projectAudit(input.orgId, input.projectId, 'launched'),
    }
  }
  const before = loadedProject(await projectRef(firestore, input.orgId, input.projectId).get())
  if (before.quote.split === 'full') {
    const nowMs = nowOf(deps)
    const project = await firestore.runTransaction(async (tx) => {
      const ref = projectRef(firestore, input.orgId, input.projectId)
      const marked = markLaunched(loadedProject(await tx.get(ref)), nowMs)
      tx.set(ref, projectDoc(marked.project))
      appendHistoryRow(tx, firestore, projectHistory(firestore, input.orgId, input.projectId), marked.row, marked.audit)
      return marked.project
    })
    return { project, invoice: null }
  }
  const seq = await raiseInvoice(firestore, input, deps, markLaunched)
  const invoice = await settleInvoice(firestore, { ...input, seq }, deps)
  const project = loadedProject(await projectRef(firestore, input.orgId, input.projectId).get())
  return { project, invoice }
}

// ── Payments ────────────────────────────────────────────────────────────────

export type SiteCareProjectPaymentOutcome = 'recorded' | 'already' | 'ignored'

/**
 * Records a project invoice as paid — from the billing webhook's
 * `invoice.paid`, or from staff's "Check payments" when a delivery was
 * missed — and emails the owner the receipt. Idempotent: a redelivery of a
 * payment already recorded changes nothing and sends nothing.
 */
export async function recordSiteCareProjectPayment(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    invoiceId: string
    metadata: Readonly<Record<string, string>>
    amountPaidCents: number
    paidOutOfBand?: boolean
  },
  deps: SiteCareDeps = {},
): Promise<SiteCareProjectPaymentOutcome> {
  const projectId = input.metadata[SITE_CARE_PROJECT_METADATA_KEY]
  if (!projectId || !input.invoiceId) return 'ignored'
  const nowMs = nowOf(deps)
  const result = await firestore.runTransaction(async (tx) => {
    const ref = projectRef(firestore, input.orgId, projectId)
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) return null
    const project = loadedProject(snapshot)
    const invoice = project.invoices.find((row) => row.invoiceId === input.invoiceId)
    if (!invoice) return null
    if (invoice.status === 'paid') return { outcome: 'already' as const, project, invoice }
    // A voided or credited invoice reads as "paid" at nothing once fully
    // credited; that is not money arriving.
    const unpayable: SiteCareProjectInvoiceStatus[] = ['voided', 'credited', 'refunded']
    if (unpayable.includes(invoice.status)) return null
    const paid: SiteCareProjectInvoice = {
      ...invoice,
      status: 'paid',
      amountPaidCents: Math.max(0, Math.floor(input.amountPaidCents)),
      error: null,
      paidAtMs: nowMs,
      updatedAtMs: nowMs,
    }
    const updated: SiteCareProject = {
      ...withInvoice(project, paid),
      firstInvoiceSentAtMs: project.firstInvoiceSentAtMs ?? nowMs,
      updatedAtMs: nowMs,
    }
    tx.set(ref, projectDoc(updated))
    appendHistoryRow(
      tx,
      firestore,
      projectHistory(firestore, input.orgId, projectId),
      historyRow({
        atMs: nowMs,
        by: { uid: null, email: null },
        kind: 'invoice.paid',
        summary: `Received ${formatSiteCareUsd(paid.amountPaidCents)} for the ${siteCareProjectInvoiceWords(paid.kind)}${input.paidOutOfBand ? ' (marked paid outside the card page)' : ''}.`,
        before: { status: invoice.status },
        after: { status: 'paid', amountPaidCents: paid.amountPaidCents },
        stripe: { object: 'invoice', id: input.invoiceId, amountCents: paid.amountPaidCents },
        subjectId: projectId,
      }),
    )
    return { outcome: 'recorded' as const, project: updated, invoice: paid }
  })
  if (!result) return 'ignored'
  if (result.outcome === 'already') return 'already'
  const { project, invoice } = result
  const amount = formatSiteCareUsd(invoice.amountPaidCents)
  const sentence = `Thank you. We received your payment of ${amount} for “${project.title}”.`
  const next =
    invoice.kind === 'deposit'
      ? 'We are starting work. The other half is invoiced when your project launches.'
      : invoice.kind === 'final'
        ? 'The project is paid in full. Thank you!'
        : 'The project is paid in full. We start work now and will let you know when it is live.'
  await emailOwner(
    firestore,
    {
      orgId: input.orgId,
      projectId,
      key: SITE_CARE_PROJECT_PAID_EMAIL_KEY,
      what: 'the payment receipt',
      merge: {
        'project.title': project.title,
        'payment.amount': amount,
        'payment.sentence': sentence,
        'payment.next': next,
      },
      fallback: { subject: `Payment received: ${project.title}`, text: `${sentence} ${next}` },
    },
    deps,
  )
  return 'recorded'
}

/**
 * Reads each unpaid invoice of a project from Stripe and records any that
 * were paid, for a webhook delivery that never arrived.
 */
export async function checkSiteCareProjectPayments(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; projectId: string },
  deps: SiteCareDeps = {},
): Promise<{ recorded: number }> {
  const project = loadedProject(await projectRef(firestore, input.orgId, input.projectId).get())
  let recorded = 0
  for (const invoice of project.invoices) {
    if (invoice.status !== 'open' || !invoice.invoiceId) continue
    const read = await readProjectInvoice(invoice.invoiceId, deps.stripe)
    if (read.ok === false) throw new SiteCareError(read.error, 502)
    if (read.state?.status !== 'paid') continue
    const outcome = await recordSiteCareProjectPayment(
      firestore,
      {
        orgId: input.orgId,
        invoiceId: invoice.invoiceId,
        metadata: { [SITE_CARE_PROJECT_METADATA_KEY]: input.projectId },
        amountPaidCents: read.state.amountPaidCents,
      },
      deps,
    )
    if (outcome === 'recorded') recorded += 1
  }
  return { recorded }
}

// ── Reversals ───────────────────────────────────────────────────────────────

export type SiteCareProjectReversal = 'void' | 'credit' | 'refund'

/**
 * Voids an unpaid invoice, credits it, or refunds a paid one — from the
 * record, with a reason, never by hand in Stripe. The intent row commits
 * before the call; the owner is emailed the outcome.
 */
export async function reverseSiteCareProjectInvoice(
  firestore: FirebaseFirestore.Firestore,
  input: {
    orgId: string
    projectId: string
    seq: number
    actor: SiteCareActor
    action: unknown
    reason: unknown
  },
  deps: SiteCareDeps = {},
): Promise<SiteCareProjectInvoice> {
  const action = String(input.action ?? '') as SiteCareProjectReversal
  if (action !== 'void' && action !== 'credit' && action !== 'refund') {
    throw new SiteCareError('Choose void, credit or refund.', 400)
  }
  const reason = requireHistoryReason(input.reason)
  if (reason.ok === false) throw new SiteCareError(reason.error, 400)
  const project = loadedProject(await projectRef(firestore, input.orgId, input.projectId).get())
  const invoice = findInvoice(project, input.seq)
  if (!invoice.invoiceId || (invoice.status !== 'open' && invoice.status !== 'paid')) {
    throw new SiteCareError('Only a sent invoice, unpaid or paid, can be voided, credited or refunded.', 409)
  }
  const read = await readProjectInvoice(invoice.invoiceId, deps.stripe)
  if (read.ok === false) throw new SiteCareError(read.error, 502)
  const stage = read.state?.status ?? 'missing'
  if (action === 'refund' && stage !== 'paid') {
    throw new SiteCareError(`The invoice is ${stage} in Stripe, not paid; void or credit it instead.`, 409)
  }
  if (action !== 'refund' && stage !== 'open') {
    throw new SiteCareError(
      stage === 'paid'
        ? 'The invoice is paid. Check payments to record it, then refund it.'
        : `The invoice is ${stage} in Stripe; there is nothing to ${action}.`,
      409,
    )
  }
  if (action !== 'void' && !invoice.invoiceItemId) {
    throw new SiteCareError('The record has no line to credit on this invoice.', 409)
  }
  const words = siteCareProjectInvoiceWords(invoice.kind)
  const amount = formatSiteCareUsd(invoice.amountCents)
  const history = projectHistory(firestore, input.orgId, input.projectId)
  // The intent first, so a call whose answer is lost still left a row.
  await commitHistoryRow(
    firestore,
    history,
    historyRow({
      atMs: nowOf(deps),
      by: input.actor,
      kind: `invoice.${action}Requested`,
      summary: `Reversing the ${words} invoice (${amount}): ${action}.`,
      reason: reason.reason,
      before: { seq: invoice.seq, status: invoice.status, stage },
      subjectId: input.projectId,
    }),
    projectAudit(input.orgId, input.projectId, `invoice.${action}Requested`),
  )
  let next: SiteCareProjectInvoice
  let stripe: HistoryStripeRef
  if (action === 'void') {
    const voided = await voidProjectInvoice(
      { invoiceId: invoice.invoiceId, idempotencyKey: `${invoice.idempotencyKey}:void` },
      deps.stripe,
    )
    if (voided.ok === false) throw new SiteCareError(voided.error, 502)
    next = { ...invoice, status: 'voided', error: null, updatedAtMs: nowOf(deps) }
    stripe = { object: 'invoice', id: invoice.invoiceId, amountCents: invoice.totalCents || invoice.amountCents }
  } else {
    const credited = await creditExtraTimeItem(
      {
        invoiceId: invoice.invoiceId,
        invoiceItemId: String(invoice.invoiceItemId),
        refund: action === 'refund',
        memo: `Project: ${reason.reason}`,
        metadata: { [SITE_CARE_PROJECT_METADATA_KEY]: input.projectId, orgId: input.orgId },
        idempotencyKey: `${invoice.idempotencyKey}:${action}`,
      },
      deps.stripe,
    )
    if (credited.ok === false) throw new SiteCareError(credited.error, 502)
    next = {
      ...invoice,
      status: action === 'refund' ? 'refunded' : 'credited',
      creditNoteId: credited.creditNoteId,
      refundId: credited.refundId,
      error: null,
      updatedAtMs: nowOf(deps),
    }
    stripe = { object: 'credit_note', id: credited.creditNoteId, amountCents: credited.amountCents }
  }
  const doneKind = `invoice.${next.status}`
  await firestore.runTransaction(async (tx) => {
    const ref = projectRef(firestore, input.orgId, input.projectId)
    const current = loadedProject(await tx.get(ref))
    tx.set(ref, projectDoc({ ...withInvoice(current, next), updatedAtMs: nowOf(deps) }))
    appendHistoryRow(
      tx,
      firestore,
      history,
      historyRow({
        atMs: nowOf(deps),
        by: input.actor,
        kind: doneKind,
        summary:
          next.status === 'voided'
            ? `Voided the ${words} invoice (${amount}); nothing is owed on it.`
            : next.status === 'refunded'
              ? `Refunded the ${words} (${amount} plus its tax) to the card it was paid with.`
              : `Credited the ${words} invoice (${amount} plus its tax); nothing is owed on it.`,
        reason: reason.reason,
        before: { status: invoice.status },
        after: { status: next.status, creditNoteId: next.creditNoteId, refundId: next.refundId },
        stripe,
        subjectId: input.projectId,
      }),
      projectAudit(input.orgId, input.projectId, doneKind),
    )
  })
  const heading =
    next.status === 'voided' ? 'Invoice canceled' : next.status === 'refunded' ? 'Payment refunded' : 'Invoice credited'
  const sentence =
    next.status === 'voided'
      ? `We canceled the ${amount} ${words} invoice for “${project.title}”. You do not owe it.`
      : next.status === 'refunded'
        ? `We refunded the ${amount} ${words} for “${project.title}”, with its tax, to the card it was paid with.`
        : `We credited the ${amount} ${words} invoice for “${project.title}”, with its tax. You do not owe it.`
  await emailOwner(
    firestore,
    {
      orgId: input.orgId,
      projectId: input.projectId,
      key: SITE_CARE_PROJECT_REVERSED_EMAIL_KEY,
      what: 'the invoice notice',
      merge: {
        'project.title': project.title,
        'reversal.heading': heading,
        'reversal.sentence': sentence,
        'reversal.reason': reason.reason,
      },
      fallback: { subject: `${heading}: ${project.title}`, text: `${sentence}\n\nWhy: ${reason.reason}` },
    },
    deps,
  )
  return next
}

// ── Reading ─────────────────────────────────────────────────────────────────

export interface SiteCareProjectView {
  projectId: string
  project: SiteCareProject
  history: Array<AppendOnlyHistoryRow & { $id: string }>
}

/** A workspace's projects, newest first, each with its history. */
export async function readSiteCareProjects(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<SiteCareProjectView[]> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(SITE_CARE_PROJECTS_COLLECTION)
    .orderBy('createdAtMs', 'desc')
    .limit(100)
    .get()
  const views = await Promise.all(
    snapshot.docs.map(async (doc) => {
      const project = readSiteCareProject(doc.data())
      if (!project) return null
      const history = await readHistoryRows(doc.ref.collection(SITE_CARE_HISTORY_COLLECTION))
      return { projectId: doc.id, project, history }
    }),
  )
  return views
    .filter((view): view is SiteCareProjectView => Boolean(view))
    .sort((a, b) => b.project.createdAtMs - a.project.createdAtMs)
}
