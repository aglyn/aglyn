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

// Fails when a legal Google Doc drifts from its published page (AGL-1611).
//
// Since the 2026-08-13 move to Google Docs, `Platform Docs/Legal/*.gdoc` are
// 169-byte POINTERS — no content on disk, so nothing could diff a Doc against
// what `aglyn.com/legal/<slug>` actually serves, and the two are known to have
// diverged (AGL-1647 tracks writing v4 back into the Docs). This script is the
// missing verification step, deliberately READ-ONLY: it does not publish, does
// not write to the Docs, and does not touch Firestore. The human
// paste-and-publish flow stays; this makes its drift visible.
//
//   npm run check:legal-drift                # every mapped document
//   npm run check:legal-drift -- privacy dpa # a subset, by slug
//
//   --legal-dir=PATH  where the `.gdoc` pointer files live. Default: the
//                     `Platform Docs/Legal` folder of the aglyn.com Drive
//                     (LEGAL_DOCS_DIR overrides).
//   --folder=ID       resolve Doc ids by listing this Drive folder via the
//                     API instead of reading local pointer files — for
//                     machines without the Drive File Stream mount.
//   --paste           ALSO emit, per checked document, the ready-to-paste
//                     markdown-lite content block (exported from the Doc as
//                     `text/markdown` and folded to the besigner dialect)
//                     into --out, plus a preview of the "On this page" TOC
//                     the mui Table-of-contents element will derive from it
//                     (AGL-1162 — the TOC is NOT pasted; it regenerates from
//                     the body's headings), with an anchor diff against the
//                     live page so a reworded heading that breaks inbound
//                     deep links is visible BEFORE the paste. Still
//                     read-only: the paste and Publish stay human, because
//                     legal snapshots are publication-first.
//   --out=DIR         where --paste writes `<slug>.markdown-lite.md`.
//                     Default: <os tmpdir>/aglyn-legal-paste.
//
// Auth: the rules-drift checker's exact env pattern (root .env, self-loaded,
// already-set env wins) — but NOT its token mint: firebase-admin scopes its
// tokens to Firebase/GCP APIs, and Drive needs `drive.readonly`, so this
// script signs its own JWT with the same FIREBASE_PRIVATE_KEY.
//
// THE SERVICE ACCOUNT MUST BE ABLE TO SEE THE DOCS. Drive answers 404 (not
// 403) for files a caller cannot see, so "file not found" here almost always
// means "not shared yet". The fix is a one-time click:
//   share `Platform Docs` (or its `Legal` folder) with
//   firebase-adminsdk-fcgi3@aglyn-main.iam.gserviceaccount.com as Viewer.
//
// Exit codes — the drift-checker convention (see check-rules-drift.mjs):
//   0  every compared document is in sync
//   1  at least one document differs (unified diff printed per document)
//   2  nothing differs but at least one document could not be checked
//      (unshared Doc, Drive API disabled, missing creds, network, dead page)

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSign } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  loadLocalEnv,
  readServiceAccount,
} from './lib/firebase-rules-api.mjs'
import { renderUnifiedDiff } from './lib/rules-drift.mjs'
import {
  collectTocFromMarkdownLite,
  compareLegalDocument,
  docMarkdownToMarkdownLite,
  extractLiveTocAnchors,
  overallExitCode,
  parseGdocPointer,
  renderTocPreview,
  slugForPointerName,
} from './lib/legal-doc-diff.mjs'

const LEGAL_ORIGIN = 'https://aglyn.com'
const SA_EMAIL_HINT = 'firebase-adminsdk-fcgi3@aglyn-main.iam.gserviceaccount.com'
const DEFAULT_LEGAL_DIR =
  '/Users/zgover/Library/CloudStorage/GoogleDrive-zach@aglyn.com/Shared drives/Platform Docs/Legal'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

function parseArgs(argv) {
  const args = { slugs: [], legalDir: null, folder: null, paste: false, out: null }
  for (const raw of argv) {
    if (raw.startsWith('--legal-dir=')) args.legalDir = raw.slice('--legal-dir='.length)
    else if (raw.startsWith('--folder=')) args.folder = raw.slice('--folder='.length)
    else if (raw === '--paste') args.paste = true
    else if (raw.startsWith('--out=')) args.out = raw.slice('--out='.length)
    else if (raw.startsWith('--')) {
      throw new Error(`unknown flag: ${raw}`)
    } else args.slugs.push(raw)
  }
  return args
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Mint a Drive-scoped access token from the service account. Hand-signed
 * JWT-bearer grant rather than firebase-admin, because admin's token carries
 * only Firebase/GCP scopes and Drive would 403 it regardless of sharing.
 */
async function mintDriveToken({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000)
  const unsigned =
    b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) +
    '.' +
    b64url(
      JSON.stringify({
        iss: clientEmail,
        scope: DRIVE_SCOPE,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    )
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey)
  const assertion = `${unsigned}.${b64url(signature)}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new Error(
      `token exchange failed (HTTP ${res.status}): ${body.error_description || body.error || 'no access_token'}`,
    )
  }
  return body.access_token
}

/** The Docs to check: [{ name, docId, slug }]. */
function resolveFromPointerFiles(legalDir) {
  let entries
  try {
    entries = readdirSync(legalDir)
  } catch (error) {
    throw new Error(`cannot read ${legalDir}: ${error.message}`)
  }
  const docs = []
  for (const file of entries.filter((f) => f.endsWith('.gdoc')).sort()) {
    const docId = parseGdocPointer(readFileSync(join(legalDir, file), 'utf8'))
    const { name, slug, known } = slugForPointerName(file)
    if (!docId) {
      console.warn(`WARN  ${file}: not a Drive pointer (no doc_id) — skipped`)
      continue
    }
    if (!known) {
      console.warn(
        `WARN  ${file}: not in DOC_TO_SLUG — add it to tools/scripts/lib/legal-doc-diff.mjs (checked as nothing until then)`,
      )
      continue
    }
    docs.push({ name, docId, slug })
  }
  return docs
}

async function resolveFromDriveFolder(folderId, token) {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', `'${folderId}' in parents and trashed = false`)
  url.searchParams.set('fields', 'files(id,name,mimeType)')
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('supportsAllDrives', 'true')
  url.searchParams.set('includeItemsFromAllDrives', 'true')
  url.searchParams.set('corpora', 'allDrives')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    throw new Error(`Drive folder listing failed (HTTP ${res.status}): ${await res.text()}`)
  }
  const { files = [] } = await res.json()
  const docs = []
  for (const file of files) {
    if (file.mimeType !== 'application/vnd.google-apps.document') continue
    const { name, slug, known } = slugForPointerName(`${file.name}.gdoc`)
    if (!known) {
      console.warn(`WARN  Drive doc "${file.name}": not in DOC_TO_SLUG — skipped`)
      continue
    }
    docs.push({ name, docId: file.id, slug })
  }
  return docs.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * @returns {{ ok: true, text: string } | {
 *   ok: false, status: number, detail: string, apiDisabled: boolean }}
 */
async function exportDocAsText(docId, token, mimeType = 'text/plain') {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(docId)}/export?mimeType=${encodeURIComponent(mimeType)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const raw = await res.text()
    let detail = raw.slice(0, 400)
    try {
      detail = JSON.parse(raw)?.error?.message || detail
    } catch {
      // keep the raw slice
    }
    return {
      ok: false,
      status: res.status,
      detail,
      // The Drive API being off is a different one-time click than sharing,
      // and conflating them sends Zach to the wrong screen.
      apiDisabled: /has not been used in project|it is disabled/i.test(detail),
    }
  }
  return { ok: true, text: await res.text() }
}

/** @returns {{ ok: true, html: string } | { ok: false, status: number }} */
async function fetchLivePage(slug) {
  const res = await fetch(`${LEGAL_ORIGIN}/legal/${slug}`, {
    headers: { 'User-Agent': 'aglyn-legal-doc-diff (AGL-1611)' },
  })
  if (!res.ok) return { ok: false, status: res.status }
  return { ok: true, html: await res.text() }
}

function sharingHelp(legalDirLabel) {
  return [
    '',
    'The service account cannot see the Legal Google Docs. Drive reports',
    '"not found" for anything unshared, so this is almost certainly the',
    'one-time sharing step, not a wrong id:',
    '',
    `  1. Open ${legalDirLabel}`,
    '     (drive.google.com → Shared drives → Platform Docs → Legal)',
    '  2. Share the folder (or the whole shared drive) with',
    `       ${SA_EMAIL_HINT}`,
    '     as Viewer. Reader access is enough; the checker never writes.',
    '  3. Re-run: npm run check:legal-drift',
    '',
  ].join('\n')
}

function apiDisabledHelp() {
  return [
    '',
    'The Google Drive API is DISABLED on project aglyn-main, so the service',
    'account cannot export anything regardless of sharing. One-time enable:',
    '',
    '  1. https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=aglyn-main',
    '     → Enable (read-only use; the checker only ever exports text)',
    '  2. Wait a few minutes for it to propagate, then re-run:',
    '     npm run check:legal-drift',
    '',
    'Sharing the Legal folder with the service account may ALSO be needed —',
    `share it with ${SA_EMAIL_HINT}`,
    'as Viewer — but Drive cannot say until the API itself is on.',
    '',
  ].join('\n')
}

/**
 * The --paste emission for one document: export the Doc as `text/markdown`,
 * fold it to the besigner markdown-lite dialect sliced to the content block,
 * write it to `<outDir>/<slug>.markdown-lite.md`, and print the TOC the
 * Table-of-contents element will derive from it — with the anchor delta
 * against the live page, so a heading rename that kills an inbound deep link
 * is seen before the paste, not after.
 *
 * Failures here never change the drift verdict: the compare already ran on
 * the plain-text export, and a paste block that cannot be produced is
 * reported as exactly that.
 */
async function emitPasteBlock({ slug, docId, token, liveHtml, outDir }) {
  const mdSide = await exportDocAsText(docId, token, 'text/markdown')
  if (!mdSide.ok) {
    console.log(
      `PASTE       /legal/${slug} — markdown export failed (HTTP ${mdSide.status}): ${mdSide.detail}`,
    )
    return
  }
  const block = docMarkdownToMarkdownLite(mdSide.text)
  if (!block.text) {
    console.log(`PASTE       /legal/${slug} — markdown export produced no content block`)
    return
  }
  const flags = []
  if (!block.foundStart) flags.push('no "Last updated:" line — block starts at top of Doc')
  if (!block.foundEnd) flags.push('no closing "©" line — block runs to end of Doc')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${slug}.markdown-lite.md`)
  writeFileSync(outPath, block.text)
  const suffix = flags.length ? `  [${flags.join('; ')}]` : ''
  console.log(
    `PASTE       /legal/${slug} → ${outPath} (${Buffer.byteLength(block.text)} bytes)${suffix}`,
  )
  const toc = collectTocFromMarkdownLite(block.text)
  if (!toc.length) {
    console.log('  TOC: the block has no ## / ### headings — the aside will render empty')
    return
  }
  console.log(`  TOC the page will derive (${toc.length} headings):`)
  for (const line of renderTocPreview(toc, extractLiveTocAnchors(liveHtml ?? ''))) {
    console.log(`  ${line}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  loadLocalEnv()
  const account = readServiceAccount()
  if (!account) {
    console.error(
      'CANNOT CHECK: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY missing — run from the repo root, where .env provides them.',
    )
    return 2
  }

  let token
  try {
    token = await mintDriveToken(account)
  } catch (error) {
    console.error(`CANNOT CHECK: ${error.message}`)
    return 2
  }

  const legalDir = args.legalDir || process.env.LEGAL_DOCS_DIR || DEFAULT_LEGAL_DIR
  let docs
  try {
    docs = args.folder
      ? await resolveFromDriveFolder(args.folder, token)
      : resolveFromPointerFiles(legalDir)
  } catch (error) {
    console.error(`CANNOT CHECK: ${error.message}`)
    return 2
  }
  if (args.slugs.length) {
    const wanted = new Set(args.slugs)
    docs = docs.filter((d) => d.slug && wanted.has(d.slug))
    const found = new Set(docs.map((d) => d.slug))
    for (const slug of wanted) {
      if (!found.has(slug)) console.warn(`WARN  no legal Doc maps to slug "${slug}"`)
    }
  }
  if (!docs.length) {
    console.error('CANNOT CHECK: no legal documents resolved to compare.')
    return 2
  }

  const outDir = args.out || join(tmpdir(), 'aglyn-legal-paste')
  const verdicts = []
  let unsharedCount = 0
  let apiDisabled = false
  for (const { name, docId, slug } of docs) {
    if (!slug) {
      console.log(`SKIPPED     ${name} — internal document, no published page by design`)
      verdicts.push({ slug: name, status: 'skipped' })
      continue
    }
    const [docSide, liveSide] = await Promise.all([
      exportDocAsText(docId, token),
      fetchLivePage(slug),
    ])
    if (!docSide.ok) {
      if (docSide.apiDisabled) apiDisabled = true
      else if (docSide.status === 404 || docSide.status === 403) unsharedCount += 1
      console.log(
        `UNREADABLE  /legal/${slug} — Doc export failed (HTTP ${docSide.status}): ${docSide.detail}`,
      )
      verdicts.push({ slug, status: 'unreadable' })
      continue
    }
    if (!liveSide.ok) {
      console.log(`UNREADABLE  /legal/${slug} — live page returned HTTP ${liveSide.status}`)
      verdicts.push({ slug, status: 'unreadable' })
      continue
    }
    const result = compareLegalDocument(liveSide.html, docSide.text)
    const caveats = result.caveats.length ? `  [${result.caveats.join('; ')}]` : ''
    if (result.inSync) {
      console.log(`IN SYNC     /legal/${slug}${caveats}`)
      verdicts.push({ slug, status: 'in-sync' })
    } else {
      console.log(`DIFFERS     /legal/${slug}${caveats}`)
      console.log(
        renderUnifiedDiff(result.live.text, result.doc.text, {
          fileName: `${slug}.txt`,
          baselineLabel: 'google-doc',
        }),
      )
      verdicts.push({ slug, status: 'differs' })
    }
    if (args.paste) {
      await emitPasteBlock({ slug, docId, token, liveHtml: liveSide.html, outDir })
    }
  }

  if (apiDisabled) {
    console.error(apiDisabledHelp())
  } else if (unsharedCount > 0) {
    console.error(sharingHelp(args.folder ? `Drive folder ${args.folder}` : legalDir))
  }
  const code = overallExitCode(verdicts)
  const counts = ['in-sync', 'differs', 'unreadable', 'skipped']
    .map((s) => `${verdicts.filter((v) => v.status === s).length} ${s}`)
    .join(', ')
  console.log(`\n${counts} — exit ${code}`)
  return code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`CANNOT CHECK: ${error.stack || error}`)
      process.exit(2)
    },
  )
}
