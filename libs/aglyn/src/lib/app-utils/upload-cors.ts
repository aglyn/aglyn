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

/**
 * Which origins may complete a signed direct-to-GCS upload (AGL-1452).
 *
 * ## The fact this module exists for
 *
 * **GCS matches the CORS `origin` list as an exact string.** There is no
 * subtree form and no wildcard form short of `*`. Measured against the live
 * bucket on 2026-08-20 by driving real preflights: `https://app.aglyn.com`
 * answers with `Access-Control-Allow-Origin`, while `https://console.aglyn.com`,
 * `https://app.aglyn.io`, `https://zgover.aglyn.com`, `http://app.aglyn.com`
 * and `https://app.aglyn.com.evil.example` all answer 200 with **no CORS
 * headers at all** — which is how the browser refuses the `PUT`.
 *
 * This is the OPPOSITE of the App Check reCAPTCHA allowlist, which matches a
 * listed name and everything beneath it. Both are "allowed domains for the
 * platform", so reasoning across from one to the other is the natural move and
 * gives exactly the wrong answer.
 *
 * ## Why it bites, and only sometimes
 *
 * The signed direct-to-GCS path carries video, PDF and ZIP above
 * `SIGNED_UPLOAD_MAX_BYTES`; ordinary images take the base64 route and are
 * unaffected. So a missing origin fails **only on large files**, behind a
 * generic "try again" snackbar with no diagnosable cause — the same silence
 * that let AGL-1408 ship with no CORS rule at all.
 *
 * A console origin appears whenever a name is attached to the project WITHOUT
 * a redirect. Attached WITH one, the browser never holds that origin — it is
 * already at the redirect target when it uploads — which is why
 * `console.aglyn.com` needs no entry and `zgover.aglyn.com` does.
 *
 * ## Why `*` is not on the table
 *
 * The signed URL carries the authorization. A wildcard would let any site on
 * the internet spend one that leaks. {@link permitsUploadOrigin} still reports
 * a wildcard as permitting, because its job is to describe the bucket
 * truthfully — a check that called `*` "missing" would report a failure while
 * the uploads it watches were in fact wide open. {@link mergeUploadOrigins} is
 * where we refuse to ever write one.
 *
 * ## Why a MERGE
 *
 * `gcloud storage buckets update --cors-file` **replaces** the configuration
 * rather than merging it. Automation that builds a fresh document from the
 * origins it happens to know about silently drops every other customer's
 * origin, and the symptom lands on them, days later, as a failed large upload
 * nobody can attribute. Everything here is read-modify-write.
 */

export interface CorsRule {
  origin?: string[]
  method?: string[]
  responseHeader?: string[]
  maxAgeSeconds?: number
}

/** The method the DAM uploader issues. Parsed out of it by `storage-cors.spec.ts`. */
export const UPLOAD_CORS_METHOD = 'PUT'

/** The headers that `PUT` sets, which the preflight answers from. */
export const UPLOAD_CORS_RESPONSE_HEADERS = ['Content-Type', 'x-goog-resumable']

/** One hour, matching `cloud/storage-cors.json`. */
export const UPLOAD_CORS_MAX_AGE_SECONDS = 3600

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * The origin a browser on `host` will actually put in the `Origin` header.
 *
 * Accepts a bare hostname or a URL, because callers hold both shapes: a
 * console-domain claim stores a hostname and `NEXT_PUBLIC_CONSOLE_URL` carries
 * a scheme. Null for anything that is not a hostname — including `*`, which is
 * never a thing this function will hand onward.
 */
export function uploadOriginFor(host: string): string | null {
  const raw = String(host ?? '').trim().toLowerCase()
  if (!raw) return null
  const bare = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/\.$/, '')
  return HOSTNAME.test(bare) ? `https://${bare}` : null
}

function uploadRules(rules: CorsRule[]): CorsRule[] {
  return rules.filter((rule) =>
    (rule.method ?? []).some(
      (method) => method.toUpperCase() === UPLOAD_CORS_METHOD,
    ),
  )
}

/**
 * Would this bucket configuration let a browser at `origin` complete the
 * signed `PUT`?
 *
 * Exact comparison, deliberately: matching loosely here would make this agree
 * with the intuition and disagree with GCS, which is the whole failure being
 * guarded against.
 */
export function permitsUploadOrigin(
  rules: CorsRule[] | null | undefined,
  origin: string,
): boolean {
  if (!rules) return false
  return uploadRules(rules).some((rule) =>
    (rule.origin ?? []).some((listed) => listed === '*' || listed === origin),
  )
}

/**
 * The origins this configuration would refuse, in the order asked.
 *
 * A null configuration — the read failed, the bucket is unreachable — covers
 * NOTHING. Reporting calm because we could not look is the shape of alarm that
 * has already cost this repo three outages.
 */
export function missingUploadOrigins(
  rules: CorsRule[] | null | undefined,
  origins: string[],
): string[] {
  return origins.filter((origin) => !permitsUploadOrigin(rules, origin))
}

/**
 * The configuration to WRITE so `origins` can upload, preserving everything
 * already permitted.
 *
 * Adds to the existing upload rule where there is one, so the policy does not
 * grow a rule per customer. Throws on a wildcard rather than returning an
 * error, because there is no caller for whom emitting one is the right
 * outcome and a returned error is a thing a caller can ignore.
 */
export function mergeUploadOrigins(
  rules: CorsRule[],
  origins: string[],
): { rules: CorsRule[]; added: string[] } {
  if (origins.some((origin) => String(origin).includes('*'))) {
    throw new Error(
      'refusing to write a wildcard CORS origin: the signed URL carries the ' +
        'authorization, so `*` lets any site spend one that leaks (AGL-1452)',
    )
  }
  const wanted = [...new Set(origins)]
  const missing = missingUploadOrigins(rules, wanted)
  if (missing.length === 0) return { rules, added: [] }

  const target = rules.findIndex((rule) => uploadRules([rule]).length === 1)
  if (target < 0) {
    return {
      rules: [
        ...rules,
        {
          origin: missing,
          method: [UPLOAD_CORS_METHOD],
          responseHeader: [...UPLOAD_CORS_RESPONSE_HEADERS],
          maxAgeSeconds: UPLOAD_CORS_MAX_AGE_SECONDS,
        },
      ],
      added: missing,
    }
  }
  const next = rules.map((rule, index) =>
    index === target
      ? { ...rule, origin: [...new Set([...(rule.origin ?? []), ...missing])] }
      : rule,
  )
  return { rules: next, added: missing }
}

/**
 * What a human must run when the automation could not.
 *
 * Carries the warning as well as the command: the obvious one-liner is the
 * destructive one, and an instruction that omits that is how the read-modify-
 * write rule gets skipped by the person following it in a hurry.
 */
export function uploadCorsRemedy(bucket: string, missing: string[]): string {
  return [
    `Large (resumable) uploads from ${missing.join(', ')} will fail until`,
    `gs://${bucket} permits ${missing.length === 1 ? 'that origin' : 'those origins'}.`,
    'GCS matches the CORS origin list EXACTLY — there is no subtree form, so',
    'each origin needs its own entry.',
    '',
    '  gcloud storage buckets describe gs://' + bucket + ' --format=json\\(cors_config\\) > cors.json',
    '  # edit cors.json: ADD the origins above to the rule whose method is PUT',
    `  gcloud storage buckets update gs://${bucket} --cors-file=cors.json`,
    '',
    '⚠️ --cors-file REPLACES the configuration rather than merging it. Read the',
    'live document, add to it, write it back — building a fresh one drops every',
    'other origin, and that failure lands on someone else, days later.',
  ].join('\n')
}
