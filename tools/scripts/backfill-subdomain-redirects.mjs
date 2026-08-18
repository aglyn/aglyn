/**
 * Backfill the platform-subdomain edge redirects (AGL-1273).
 *
 *   VERCEL_TOKEN=… VERCEL_TENANT_PROJECT_ID=… [VERCEL_TEAM_ID=…] \
 *     node tools/scripts/backfill-subdomain-redirects.mjs [--apply]
 *
 * DRY RUN BY DEFAULT. Idempotent.
 *
 * The attach route now registers `{subdomain}.aglyn.app` as a Vercel
 * per-domain redirect to the host's custom domain, so the hop preserves the
 * query string the app-level ISR redirect structurally cannot. Hosts that
 * connected a domain BEFORE that change (and any host left flagged
 * `subdomainRedirectPending` by a transient failure) still lack the edge
 * entry — this walks every host carrying a `cname` and upserts it.
 *
 * Reports scanned / candidates / already-correct / changed as separate
 * numbers, per the house rule: "0 changed" alone is indistinguishable from
 * "matched nothing".
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')
const token = process.env.VERCEL_TOKEN
const projectId = process.env.VERCEL_TENANT_PROJECT_ID
const teamId = process.env.VERCEL_TEAM_ID
const TENANT_APEX = process.env.AGLYN_TENANT_APEX ?? 'aglyn.app'

if (apply && (!token || !projectId)) {
  console.error('--apply needs VERCEL_TOKEN and VERCEL_TENANT_PROJECT_ID')
  process.exit(1)
}

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
}

/**
 * Does the custom domain actually SERVE? (AGL-1913)
 *
 * The attach route stopped registering this redirect for a domain that is
 * attached but not serving — an ownership challenge outstanding, or DNS that
 * no longer points here — because redirecting the platform subdomain at a dead
 * domain costs the site BOTH its addresses. This script walks every host
 * carrying a `cname` and, before that gate existed, would have happily
 * registered exactly the redirects the gate now withholds: one `--apply` run
 * would undo the fix for precisely the hosts it protects.
 *
 * Same two reads the route's status probe makes, in the same order. Unknown is
 * treated as SERVING, matching the route: a platform API that cannot answer
 * must not strand a healthy domain, and this path is guarded by a dry run
 * plus an explicit `--apply` either way.
 */
async function customDomainServes(domain) {
  try {
    const attached = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (attached.status === 404) return { serves: false, why: 'not attached' }
    if (!attached.ok) return { serves: true, why: 'state unknown' }
    const payload = await attached.json()
    if (payload?.verified === false) {
      return { serves: false, why: 'ownership check pending' }
    }
    const configured = await fetch(
      `https://api.vercel.com/v6/domains/${encodeURIComponent(domain)}/config${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!configured.ok) return { serves: true, why: 'state unknown' }
    const dns = await configured.json()
    return dns?.misconfigured === true
      ? { serves: false, why: 'DNS does not point here' }
      : { serves: true, why: 'serving' }
  } catch (error) {
    console.error(`  ! status ${domain}:`, error?.message ?? error)
    return { serves: true, why: 'state unknown' }
  }
}

/** The redirect the edge should carry for one host, or null when correct. */
async function currentRedirect(name) {
  const response = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}/domains/${encodeURIComponent(name)}${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (response.status === 404) return { exists: false }
  const payload = await response.json()
  return { exists: true, redirect: payload?.redirect ?? null }
}

async function upsert(name, target) {
  // BARE HOSTNAME, never a URL — see the note in attach/route.ts. Vercel
  // rejects `https://…` with a `bad_request` that blames the target for not
  // being on the project, which reads like a different problem entirely.
  const body = JSON.stringify({
    redirect: target,
    redirectStatusCode: 307,
  })
  const patch = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}/domains/${encodeURIComponent(name)}${query}`,
    { method: 'PATCH', headers, body },
  )
  if (patch.ok) return true
  if (patch.status !== 404) {
    console.error(`  ! PATCH ${name}:`, await patch.text())
    return false
  }
  const post = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/domains${query}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        redirect: target,
        redirectStatusCode: 307,
      }),
    },
  )
  if (!post.ok) console.error(`  ! POST ${name}:`, await post.text())
  return post.ok
}

let scanned = 0
let candidates = 0
let alreadyCorrect = 0
let changed = 0
let failed = 0
/** Hosts whose custom domain does not serve, so the redirect was withheld. */
let withheld = 0

const hosts = await firestore.collection('hosts').get()
for (const host of hosts.docs) {
  scanned += 1
  const cname = String(host.get('cname') ?? '').trim().toLowerCase()
  const subdomain = String(host.get('subdomain') ?? '').trim().toLowerCase()
  if (!cname || !subdomain) continue
  candidates += 1
  const name = `${subdomain}.${TENANT_APEX}`

  if (!apply) {
    // Dry run still reports the CURRENT edge state when a token is present,
    // so the run says what would change, not just what exists in Firestore.
    if (token && projectId) {
      const health = await customDomainServes(cname)
      if (!health.serves) {
        withheld += 1
        console.log(`  would SKIP    ${name} → ${cname} (${health.why})`)
        continue
      }
      const state = await currentRedirect(name)
      const correct = state.exists && state.redirect === cname
      if (correct) {
        alreadyCorrect += 1
        console.log(`  ok            ${name} → https://${cname}`)
      } else {
        console.log(
          `  would upsert  ${name} → https://${cname}` +
            (state.exists ? ` (currently redirect=${state.redirect})` : ' (no explicit entry)'),
        )
      }
    } else {
      console.log(`  would upsert  ${name} → https://${cname}  (no token — state unknown)`)
    }
    continue
  }

  const health = await customDomainServes(cname)
  if (!health.serves) {
    withheld += 1
    console.log(`  skipped   ${name} → ${cname} (${health.why})`)
    continue
  }
  const state = await currentRedirect(name)
  if (state.exists && state.redirect === cname) {
    alreadyCorrect += 1
    continue
  }
  const ok = await upsert(name, cname)
  if (ok) {
    changed += 1
    await host.ref
      .set({ subdomainRedirectPending: FieldValue.delete() }, { merge: true })
      .catch(() => undefined)
    console.log(`  upserted  ${name} → https://${cname}`)
  } else {
    failed += 1
    await host.ref
      .set({ subdomainRedirectPending: true }, { merge: true })
      .catch(() => undefined)
  }
}

console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — scanned ${scanned} host(s), ` +
    `${candidates} carry a custom domain, ${alreadyCorrect} already correct, ` +
    `${changed} upserted, ${withheld} withheld (domain not serving), ` +
    `${failed} failed.`,
)
if (!apply) console.log('Re-run with --apply (VERCEL_TOKEN required) to write.')
