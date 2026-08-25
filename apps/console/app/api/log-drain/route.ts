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
 * Where the Vercel log drains deliver (AGL-1921, the arm that closes it).
 *
 * Vercel has no native GCP Logging destination — a drain POSTs to an HTTPS
 * endpoint you host, and this is that endpoint. It forwards ONLY server
 * errors into the `vercel-runtime` log in `aglyn-main`, under the same admin
 * credential the client and server error beacons already write with.
 *
 * **ONE endpoint for BOTH Vercel projects**, on the console. `aglyn-tenant`'s
 * drain points here too: the receiver reads a project id out of each entry
 * (`jsonPayload.project`), so one deployment can attribute both, and a tenant
 * runtime too broken to answer anything still has its 5xx counted somewhere
 * that answers. Same reasoning as `/api/health/server-errors` next door.
 *
 * ## What arrives here, and what leaves
 *
 * A drain streams EVERY request log for both projects. Forwarding all of it
 * would turn a ~$20/month monitoring budget into a large Logging bill, so the
 * gate in `libs/tenant/data/admin/.../vercel-log-drain.ts` drops everything
 * that is not a 5xx, a crashed lambda or a `fatal` — before any write. On a
 * healthy day this endpoint accepts a great deal of traffic and writes
 * nothing at all, which is the intended steady state, not a fault.
 *
 * ## Trust
 *
 * `x-vercel-signature` is an HMAC-SHA1 of the RAW body keyed by the drain
 * secret. The raw text is read BEFORE any parse — parsing and re-serializing
 * cannot reproduce the digest — and compared timing-safely. FAILS CLOSED: no
 * secret configured, no header, or a bad one, and nothing is written, ever.
 * The URL is not a secret (it is in the Vercel dashboard and in this repo);
 * the signature is the whole boundary.
 *
 * ## The feedback loop, and why it cannot happen
 *
 * This route runs on `aglyn-console`, whose logs this same drain collects. A
 * receiver that logged or errored would see its own entry drained back in.
 * `RECEIVER_ROUTE_PATH` drops every entry whose path is this route before the
 * 5xx gate, so the receiver's own 500s are structurally unforwardable; and
 * every line the ingest path writes about itself is `console.warn`, i.e.
 * `level: "warning"`, which the 5xx gate drops on a second, independent
 * property. Both cuts are asserted in `vercel-log-drain.spec.ts`.
 */

// lockdown-423: exempt — infrastructure monitoring sink, like the sibling
// health probes; no caller identity, no org context, no org-scoped action.

import {
  ingestDrainDelivery,
  isValidDrainSignature,
  parseDrainPayload,
  DRAIN_SECRET_ENV,
} from '@aglyn/tenant-data-admin'

/** Never prerender, never revalidate, never cache. */
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Byte cap before parse, the same discipline `/api/errors` and `/api/csp-report`
 * follow. Deliveries are batched, so this is generous — but an unbounded read
 * on a public endpoint is a memory exhaustion primitive whoever finds the URL.
 */
const MAX_BODY_BYTES = 2 * 1_024 * 1_024

/**
 * The endpoint-ownership handshake.
 *
 * Vercel tests a custom endpoint when the drain is created: it sends an
 * UNSIGNED request and expects `200` plus an `x-vercel-verify` response header
 * echoing the team's verification token (the token is shown in the Vercel
 * dashboard alongside the endpoint field). Set this env var to that token
 * before creating the drain.
 *
 * Note the ordering this forces: the handshake is answered with a HEADER, and
 * nothing about it can write. An unsigned request never reaches the ingest
 * path under any configuration of this variable — see `POST` below.
 */
const VERIFY_ENV = 'VERCEL_LOG_DRAIN_VERIFY'

/**
 * Applied to EVERY response, including rejections and the handshake — Vercel
 * may verify against any of them, and a header that is only present on the
 * happy path is a handshake that fails the first time it is needed.
 */
function drainHeaders(request?: Request): HeadersInit {
  const configured = process.env[VERIFY_ENV]?.trim()
  // Falls back to echoing the value the caller presented. Harmless (it is an
  // opaque token Vercel just sent us, and it authorizes nothing), and it means
  // the handshake still completes if the env var has not been set yet.
  const echoed = request?.headers.get('x-vercel-verify')?.trim()
  const verify = configured || echoed
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    ...(verify ? { 'x-vercel-verify': verify } : {}),
  }
}

/**
 * The drain delivery.
 *
 * Always answers 200 on an accepted delivery, whatever the ingest outcome:
 * Vercel disables a drain whose endpoint fails more than 80% of deliveries
 * or 50 times in an hour, so a receiver that returned 5xx during a Cloud
 * Logging wobble would switch off the monitor mid-incident. The outcome
 * counts are returned in the body instead — including `suppressed`, so the
 * lossiness is legible to whoever is looking at the delivery.
 */
export async function POST(request: Request): Promise<Response> {
  const headers = drainHeaders(request)

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json(
      { error: 'payload_too_large' },
      { status: 413, headers },
    )
  }

  // ⚠️ RAW text, before any parse. A re-serialized body will not reproduce
  // the HMAC, and the failure looks like a wrong secret rather than a bug.
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return Response.json({ error: 'unreadable_body' }, { status: 400, headers })
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return Response.json(
      { error: 'payload_too_large' },
      { status: 413, headers },
    )
  }

  const signature = request.headers.get('x-vercel-signature')
  if (
    !isValidDrainSignature(rawBody, signature, process.env[DRAIN_SECRET_ENV])
  ) {
    // The verification probe is unsigned and carries no logs; answering it 200
    // with the header above is what lets the drain be created. An unsigned
    // request that DOES carry a body is refused — and either way, nothing
    // below this line runs, so no unsigned byte is ever written to Logging.
    if (!rawBody.trim()) {
      return Response.json(
        { ok: true, verification: true },
        { status: 200, headers },
      )
    }
    return Response.json(
      { code: 'invalid_signature', error: "signature didn't match" },
      { status: 403, headers },
    )
  }

  const result = await ingestDrainDelivery(parseDrainPayload(rawBody))
  return Response.json(result, { status: 200, headers })
}

/**
 * The handshake, and a liveness answer for anyone checking the URL by hand.
 * Reads nothing and writes nothing — deliberately not a health probe, because
 * a green GET here would say nothing about whether deliveries are landing.
 */
export async function GET(request: Request): Promise<Response> {
  return Response.json(
    { ok: true, receiver: 'vercel-log-drain' },
    { status: 200, headers: drainHeaders(request) },
  )
}

export async function HEAD(request: Request): Promise<Response> {
  return new Response(null, { status: 200, headers: drainHeaders(request) })
}
