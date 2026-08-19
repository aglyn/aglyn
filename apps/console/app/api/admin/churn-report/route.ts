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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  CHURN_SURVEY_DETAIL_COLLECTION,
  CHURN_SURVEY_REASONS,
  RETENTION_COLLECTION,
  RETENTION_KINDS,
  RETENTION_SURFACES,
} from '../../_lib/retention'

/**
 * How many retention documents one report reads.
 *
 * A ceiling rather than a page: this is an aggregate, and an aggregate that
 * quietly summarises an arbitrary slice is worse than no aggregate — it reads
 * like a total. So the cap is small enough to stay cheap, and the response
 * says whether it was hit ({@link ChurnReport.capped}) so the number is never
 * mistaken for the whole truth.
 */
export const CHURN_REPORT_SCAN_LIMIT = 2000

/**
 * How many free-text answers one report returns (AGL-2294).
 *
 * The prose is the long tail of the survey — most people pick a reason and
 * type nothing — so a page of the newest is the whole readable population in
 * practice, and a bigger number would ship a wall of other people's sentences
 * to a card nobody would then read.
 */
export const CHURN_REPORT_COMMENT_LIMIT = 50

/** One free-text answer, joined to the closed-set survey it was typed on. */
export interface ChurnComment {
  /** The survey's id — the detail document shares it (AGL-1978). */
  id: string
  /** What the customer typed, verbatim, bounded at write time to 500 chars. */
  detail: string
  /** When, in epoch ms; null on a document written without a timestamp. */
  atMs: number | null
  /** The closed-set reason this prose elaborates on, when the survey is in the scan. */
  reason: string | null
  /** Cancel versus account delete. */
  surface: string | null
  /** The tier the org was on when it answered. */
  plan: string | null
}

/**
 * The staff churn report (AGL-2248, under AGL-1863 / AGL-1859 §3).
 *
 * `orgs/{orgId}/retention` had five writers and NO reader. The funnel stored
 * every why-are-you-leaving answer exactly as asked and nothing anywhere could
 * look at them: the collection is Admin-SDK-only by construction (the orgs
 * rules block matches subcollections by name and has no wildcard), so there is
 * not even a client path to it, and reading them meant opening the Firebase
 * console one workspace at a time.
 *
 * GA4 carries the counts, deliberately WITHOUT the free text — customer prose
 * must not go into analytics params — and Firestore is where that text went
 * instead. Which made the funnel's most useful artifact write-only.
 *
 * ⚠️ NO `where` AND NO `orderBy`, on purpose.
 *
 * A filtered or ordered COLLECTION_GROUP query needs a declared field override
 * in `cloud/firebase-firestore.indexes.json`; the automatic single-field
 * indexes this project relies on are collection-scoped, which is why the file
 * declares COLLECTION_GROUP overrides explicitly for `installs`, `members` and
 * the rest. Adding one without deploying it turns `check:index-drift` red, and
 * deploying it is an infra write on a frozen launch path. An unfiltered,
 * capped scan bucketed in memory needs no index at all and answers the same
 * question at this volume.
 *
 * Free text is NOT surfaced. It lives in its own `churnSurveyDetails`
 * documents under a 365-day TTL (AGL-1978) precisely so it can expire, and a
 * rate report is not what one reads prose for.
 */
export interface ChurnReport {
  /** Surveys answered, by closed-set reason. Every reason present, incl. 0. */
  byReason: Record<string, number>
  /** Surveys answered, by funnel surface — cancel versus account delete. */
  bySurface: Record<string, number>
  /** Surveys answered, by the tier the org was on when it answered. */
  byPlan: Record<string, number>
  /** Total surveys — the denominator every rate above is taken against. */
  surveys: number
  /** Departures recorded, and how many never saw the survey at all. */
  cancels: { total: number; funnelSkipped: number }
  /** Winback offers reserved, and how many actually reached Stripe. */
  winbacks: { reserved: number; applied: number }
  /** Documents read. */
  scanned: number
  /** True when the scan hit {@link CHURN_REPORT_SCAN_LIMIT} — see above. */
  capped: boolean
  /**
   * The newest free-text answers, each joined to its survey's reason.
   *
   * AGL-2248 left this out on the argument that "a rate report is not what
   * anyone reads prose for" — right about the rate report, and it turned out
   * nothing else read it either. `churnSurveyDetails` had one writer and no
   * reader anywhere in the product, so every sentence a departing customer
   * typed sat unread until its 365-day TTL deleted it. A textarea the product
   * asks a person to fill in, whose contents nobody can ever see, is a worse
   * thing than a rate report with prose in it.
   *
   * Joined rather than listed: the closed-set `reason` is what makes a
   * sentence legible, and the detail document carries only the prose. They
   * share an id by design (AGL-1978), so the join is free.
   */
  comments: ChurnComment[]
  /** True when the free-text scan hit {@link CHURN_REPORT_SCAN_LIMIT}. */
  commentsCapped: boolean
}

/** Every closed-set key at zero, so a missing reason reads as 0, not absent. */
function zeroedReasons(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const reason of CHURN_SURVEY_REASONS) counts[reason] = 0
  return counts
}

/** Same for the two surfaces — a surface with no churn is a fact, not a gap. */
function zeroedSurfaces(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const surface of RETENTION_SURFACES) counts[surface] = 0
  return counts
}

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    // Staff claim, same posture as every other `/api/admin/*` route. These are
    // other people's stated reasons for leaving; no org-scoped permission
    // opens them, which is why the collection has no client rule either.
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const firestore = firebaseAdmin.app().firestore()
    /*
      Two unfiltered capped collection-group scans, in parallel. Same posture
      as the one above it and for the same reason: a `where` or `orderBy` here
      would need a declared field override in
      `cloud/firebase-firestore.indexes.json`, and adding one without deploying
      it turns `check:index-drift` red. Sorting the newest in memory answers
      the same question at this volume and needs no index at all.
    */
    const [snapshot, detailSnapshot] = await Promise.all([
      firestore
        .collectionGroup(RETENTION_COLLECTION)
        .limit(CHURN_REPORT_SCAN_LIMIT)
        .get(),
      firestore
        .collectionGroup(CHURN_SURVEY_DETAIL_COLLECTION)
        .limit(CHURN_REPORT_SCAN_LIMIT)
        .get(),
    ])

    const report: ChurnReport = {
      byReason: zeroedReasons(),
      bySurface: zeroedSurfaces(),
      byPlan: {},
      surveys: 0,
      cancels: { total: 0, funnelSkipped: 0 },
      winbacks: { reserved: 0, applied: 0 },
      scanned: snapshot.size,
      capped: snapshot.size >= CHURN_REPORT_SCAN_LIMIT,
      comments: [],
      commentsCapped: detailSnapshot.size >= CHURN_REPORT_SCAN_LIMIT,
    }

    /**
     * Survey context by id, for the join below. Built from the SURVEY rows
     * only — a cancel or a winback marker shares the collection but never an
     * id with a detail document.
     */
    const surveyById = new Map<
      string,
      { reason: string | null; surface: string | null; plan: string | null }
    >()

    for (const doc of snapshot.docs) {
      const kind = String(doc.get('kind') ?? '')
      if (kind === RETENTION_KINDS.survey) {
        report.surveys += 1
        const reason = String(doc.get('reason') ?? '')
        // Bucketed only if it is IN the closed set. An unknown value is
        // counted nowhere rather than inventing a column, which is the
        // difference between a breakdown and a list of typos — and the
        // route that writes these validates against the same set, so an
        // unknown one means the set changed under stored data.
        if (reason in report.byReason) report.byReason[reason] += 1
        const surface = String(doc.get('surface') ?? '')
        if (surface in report.bySurface) report.bySurface[surface] += 1
        // The plan ladder is NOT closed the way the reasons are (enterprise,
        // comped and legacy tiers all appear), so this bucket grows to fit
        // what is there. `null` plans land under 'unknown' rather than being
        // dropped: an org that answered with no plan field still answered.
        const plan = doc.get('plan')
        const planKey = plan ? String(plan) : 'unknown'
        report.byPlan[planKey] = (report.byPlan[planKey] ?? 0) + 1
        surveyById.set(doc.id, {
          reason: reason || null,
          surface: surface || null,
          plan: plan ? String(plan) : null,
        })
        continue
      }
      if (
        kind === RETENTION_KINDS.cancel ||
        kind === RETENTION_KINDS.deleteRequested
      ) {
        report.cancels.total += 1
        // The marker the cancel/delete routes write when no funnelId rode
        // along — a departure that never saw the survey. Counting it is what
        // stops the survey numbers from quietly excluding the people who
        // left through Stripe, support, or the API.
        if (doc.get('funnelSkipped') === true) report.cancels.funnelSkipped += 1
        continue
      }
      if (
        kind === RETENTION_KINDS.winbackReserved ||
        kind === RETENTION_KINDS.winbackApplied
      ) {
        report.winbacks.reserved += 1
        if (kind === RETENTION_KINDS.winbackApplied) {
          report.winbacks.applied += 1
        }
      }
    }

    /*==========================================
     * THE FREE TEXT, JOINED TO ITS REASON (AGL-2294).
     *
     * NEWEST FIRST, and by the detail document's own `createdAt` rather than
     * the survey's — they are written milliseconds apart, but the detail is
     * the document that exists here and using the other would make the order
     * depend on whether the survey happened to be inside the retention scan.
     *
     * A detail whose survey fell outside that scan still appears, with nulls
     * for the context. Dropping it would silently hide the OLDEST prose, which
     * is the half a 365-day retention window exists to preserve.
     *=========================================*/
    const timestampMs = (value: unknown): number | null => {
      const millis = (value as { toMillis?: () => number } | null)?.toMillis
      if (typeof millis !== 'function') return null
      const result = Number(millis.call(value))
      return Number.isFinite(result) ? result : null
    }
    report.comments = detailSnapshot.docs
      .map((doc) => {
        const context = surveyById.get(doc.id)
        return {
          id: doc.id,
          detail: String(doc.get('detail') ?? ''),
          atMs: timestampMs(doc.get('createdAt')),
          reason: context?.reason ?? null,
          surface: context?.surface ?? null,
          plan: context?.plan ?? null,
        }
      })
      // A detail document with no prose in it is a write that should not have
      // happened; it is not a comment, and it must not consume a slot.
      .filter((comment) => comment.detail.length > 0)
      .sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0))
      .slice(0, CHURN_REPORT_COMMENT_LIMIT)

    return Response.json(report, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Churn report failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
