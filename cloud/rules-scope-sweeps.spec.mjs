/**
 * A sweep document is the server's own bookkeeping (AGL-4047). It names no one,
 * and only the server reads or writes it, so no rule opens the path. This pins
 * that the org block's lack of a catch-all keeps it shut for every member kind,
 * with a member whose tokens come from the real projection.
 *
 * Run through `npm run test:rules`, or by hand from the repo root:
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   node cloud/rules-scope-sweeps.spec.mjs
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { createRequire } from 'node:module'
import { join } from 'node:path'

function workspaceAliases(paths) {
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    if (key.endsWith('/*')) alias[key.slice(0, -2)] = join(process.cwd(), target.replace(/\/\*$/, ''))
    else if (!(`${key}/*` in paths)) alias[key] = join(process.cwd(), target)
  }
  return alias
}

// The real projection, not a copy of it: hand-written tokens are what hid a
// site member's reach in other rules specs.
const { createJiti } = createRequire(import.meta.url)('jiti')
const { projectMemberScopeTokens } = await createJiti(import.meta.url, {
  interopDefault: true,
  fsCache: false,
  alias: workspaceAliases(JSON.parse(readFileSync('tsconfig.base.json', 'utf8')).compilerOptions.paths),
}).import(new URL('../libs/aglyn/src/lib/app-utils/organizations.ts', import.meta.url).pathname)

const ORG = 'org-scope-sweeps'
const HOST = 'host-a'
const SWEEP = `orgs/${ORG}/scopeSweeps/s1`

const env = await initializeTestEnvironment({
  projectId: 'aglyn-rules-scope-sweeps',
  firestore: { rules: readFileSync('cloud/firebase-firestore.rules', 'utf8') },
})

const members = {
  owner: { role: 'owner', allHosts: true },
  admin: { role: 'admin', allHosts: true },
  editor: { role: 'editor', allHosts: true },
  viewer: { role: 'viewer', allHosts: true },
  siteOnly: { role: 'editor', allHosts: false, hostAccess: { [HOST]: 'admin' } },
}

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  await setDoc(doc(db, `orgs/${ORG}`), { name: 'Sweep', hosts: { [HOST]: true } })
  await setDoc(doc(db, SWEEP), { reason: 'site-added', cursor: null, attempts: 0 })
  for (const [uid, member] of Object.entries(members)) {
    await setDoc(doc(db, `orgs/${ORG}/members/${uid}`), {
      ...member,
      scopeTokens: projectMemberScopeTokens(member),
    })
  }
})

for (const uid of Object.keys(members)) {
  const db = env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore()
  await assertFails(getDoc(doc(db, SWEEP)))
  await assertFails(setDoc(doc(db, SWEEP), { attempts: 9 }))
  // NEGATIVE CONTROL: the same member reads their own member document, so the
  // refusal above is about this path and not a context that can read nothing.
  await assertSucceeds(getDoc(doc(db, `orgs/${ORG}/members/${uid}`)))
}
await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), SWEEP)))

await env.cleanup()
console.log('rules-scope-sweeps: every member kind is refused, and each can read its own member document')
