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
 * Bucket CORS as GCS actually evaluates it (AGL-1452).
 *
 * Every assertion about matching here was driven against the live bucket
 * before it was written, because the intuition is wrong in a specific and
 * expensive way: the App Check reCAPTCHA allowlist matches a name and
 * everything beneath it, and reasoning across from it — the natural move,
 * since both are "allowed domains for the platform" — gives exactly the
 * opposite answer.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

import {
  mergeUploadOrigins,
  missingUploadOrigins,
  permitsUploadOrigin,
  revokeUploadOrigins,
  uploadCorsRemedy,
  uploadOriginFor,
  UPLOAD_CORS_METHOD,
  type CorsRule,
} from './upload-cors'

const REPO_ROOT = resolve(__dirname, '../../../../..')

/** The committed policy, verbatim — not a restatement of it. */
function committedRules(): CorsRule[] {
  return JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'cloud/storage-cors.json'), 'utf8'),
  ) as CorsRule[]
}

const LIVE: CorsRule[] = [
  {
    origin: ['https://app.aglyn.com'],
    method: ['PUT'],
    responseHeader: ['Content-Type', 'x-goog-resumable'],
    maxAgeSeconds: 3600,
  },
]

describe('uploadOriginFor', () => {
  it('turns a hostname into the origin a browser will actually send', () => {
    expect(uploadOriginFor('acme.example.com')).toBe('https://acme.example.com')
  })

  it('accepts a URL as readily as a bare host', () => {
    // Callers hold both shapes: a console domain claim stores a hostname,
    // NEXT_PUBLIC_CONSOLE_URL carries a scheme.
    expect(uploadOriginFor('https://acme.example.com/console')).toBe(
      'https://acme.example.com',
    )
  })

  it('lowercases, because what we WRITE must be one canonical form', () => {
    expect(uploadOriginFor('ACME.Example.COM')).toBe('https://acme.example.com')
  })

  it('refuses anything that is not a hostname', () => {
    expect(uploadOriginFor('')).toBeNull()
    expect(uploadOriginFor('   ')).toBeNull()
    expect(uploadOriginFor('*')).toBeNull()
    expect(uploadOriginFor('not a host')).toBeNull()
  })
})

describe('permitsUploadOrigin — GCS matches the origin list EXACTLY', () => {
  it('permits the origin that is listed', () => {
    expect(permitsUploadOrigin(LIVE, 'https://app.aglyn.com')).toBe(true)
  })

  it('does NOT permit a subdomain of a listed origin', () => {
    // Driven against the live bucket 2026-08-20: preflight from
    // https://zgover.aglyn.com returns 200 with NO CORS headers at all, which
    // is how the browser refuses the PUT.
    expect(permitsUploadOrigin(LIVE, 'https://zgover.aglyn.com')).toBe(false)
  })

  it('does NOT permit the same host on another scheme', () => {
    expect(permitsUploadOrigin(LIVE, 'http://app.aglyn.com')).toBe(false)
  })

  it('does NOT permit a name that merely ends with a listed one', () => {
    expect(permitsUploadOrigin(LIVE, 'https://app.aglyn.com.evil.example')).toBe(
      false,
    )
  })

  it('reports a wildcard entry as permitting, because GCS would', () => {
    // This function's job is to describe the bucket, not to approve of it. A
    // check that called `*` "missing" would report a false failure while the
    // uploads it watches were in fact wide open — the worse of the two lies.
    // `mergeUploadOrigins` is where we refuse to ever WRITE one.
    expect(permitsUploadOrigin([{ origin: ['*'], method: ['PUT'] }], 'https://x.example')).toBe(true)
  })

  it('does not count a rule that permits the origin but not the METHOD', () => {
    // A read rule for GET says nothing about whether the signed PUT can land.
    expect(
      permitsUploadOrigin(
        [{ origin: ['https://app.aglyn.com'], method: ['GET'] }],
        'https://app.aglyn.com',
      ),
    ).toBe(false)
  })
})

describe('missingUploadOrigins', () => {
  it('names every origin the bucket would refuse, in order', () => {
    expect(
      missingUploadOrigins(LIVE, [
        'https://app.aglyn.com',
        'https://acme.example.com',
        'https://zgover.aglyn.com',
      ]),
    ).toEqual(['https://acme.example.com', 'https://zgover.aglyn.com'])
  })

  it('is empty when everything is covered', () => {
    expect(missingUploadOrigins(LIVE, ['https://app.aglyn.com'])).toEqual([])
  })

  it('treats an unreadable policy as covering NOTHING', () => {
    // Fail loud, not open: if we cannot see the policy we must not report
    // that the upload will work.
    expect(missingUploadOrigins(null, ['https://app.aglyn.com'])).toEqual([
      'https://app.aglyn.com',
    ])
  })
})

describe('mergeUploadOrigins — read-modify-WRITE, never replace', () => {
  it('keeps every origin already permitted', () => {
    // The foot-gun this exists for: `gcloud storage buckets update
    // --cors-file` REPLACES the configuration. Automation that builds a fresh
    // document silently drops every other customer's origin, and the symptom
    // lands on THEM, days later, as a failed large upload.
    const { rules } = mergeUploadOrigins(LIVE, ['https://acme.example.com'])
    expect(rules[0].origin).toEqual([
      'https://app.aglyn.com',
      'https://acme.example.com',
    ])
  })

  it('reports exactly what it added', () => {
    const { added } = mergeUploadOrigins(LIVE, [
      'https://app.aglyn.com',
      'https://acme.example.com',
    ])
    expect(added).toEqual(['https://acme.example.com'])
  })

  it('is a no-op when nothing is missing', () => {
    const { rules, added } = mergeUploadOrigins(LIVE, ['https://app.aglyn.com'])
    expect(added).toEqual([])
    expect(rules).toEqual(LIVE)
  })

  it('preserves unrelated rules untouched', () => {
    const withRead: CorsRule[] = [
      ...LIVE,
      { origin: ['https://cdn.example'], method: ['GET'], maxAgeSeconds: 60 },
    ]
    const { rules } = mergeUploadOrigins(withRead, ['https://acme.example.com'])
    expect(rules[1]).toEqual(withRead[1])
  })

  it('creates the upload rule when the bucket has none', () => {
    const { rules } = mergeUploadOrigins([], ['https://acme.example.com'])
    expect(rules).toHaveLength(1)
    expect(rules[0].origin).toEqual(['https://acme.example.com'])
    expect(rules[0].method).toContain(UPLOAD_CORS_METHOD)
    expect(rules[0].responseHeader).toEqual(['Content-Type', 'x-goog-resumable'])
  })

  it('REFUSES to write a wildcard, whatever it is handed', () => {
    // The signed URL carries the authorization. A wildcard lets any site on
    // the internet spend one that leaks, so this is not a policy choice that
    // can be made per call.
    expect(() => mergeUploadOrigins(LIVE, ['*'])).toThrow(/wildcard/i)
    const { rules } = mergeUploadOrigins(LIVE, ['https://acme.example.com'])
    expect(JSON.stringify(rules)).not.toContain('"*"')
  })

  it('never duplicates an origin it was handed twice', () => {
    const { rules } = mergeUploadOrigins(LIVE, [
      'https://acme.example.com',
      'https://acme.example.com',
    ])
    expect(rules[0].origin).toEqual([
      'https://app.aglyn.com',
      'https://acme.example.com',
    ])
  })
})

describe('revokeUploadOrigins', () => {
  const rules: CorsRule[] = [
    {
      origin: [
        'https://app.aglyn.com',
        'https://acme.example',
        'https://zgover.aglyn.com',
      ],
      method: [UPLOAD_CORS_METHOD],
      responseHeader: ['Content-Type', 'x-goog-resumable'],
      maxAgeSeconds: 3600,
    },
  ]

  it('removes only what was asked and keeps the rest', () => {
    const result = revokeUploadOrigins(rules, ['https://acme.example'])
    expect(result.removed).toEqual(['https://acme.example'])
    // The counterpart of the merge's preservation assertion. A revoke that
    // rewrites instead of subtracting is the same platform-wide outage as a
    // `--cors-file` replace, reached from the other direction.
    expect(result.rules[0].origin).toEqual([
      'https://app.aglyn.com',
      'https://zgover.aglyn.com',
    ])
  })

  it('refuses an origin named in `keep`', () => {
    const result = revokeUploadOrigins(rules, ['https://app.aglyn.com'], {
      keep: ['https://app.aglyn.com'],
    })
    expect(result.removed).toEqual([])
    expect(result.refused).toEqual(['https://app.aglyn.com'])
    expect(permitsUploadOrigin(result.rules, 'https://app.aglyn.com')).toBe(true)
  })

  it('refuses `*` — a revoke is never the way to discover a wildcard', () => {
    const wide: CorsRule[] = [{ origin: ['*'], method: [UPLOAD_CORS_METHOD] }]
    const result = revokeUploadOrigins(wide, ['*'])
    expect(result.refused).toEqual(['*'])
    expect(result.removed).toEqual([])
  })

  it('drops a rule it emptied rather than writing `origin: []`', () => {
    const only: CorsRule[] = [
      { origin: ['https://gone.example'], method: [UPLOAD_CORS_METHOD] },
    ]
    // GCS accepts the empty form, and it reads to the next person like a rule
    // that permits something.
    expect(revokeUploadOrigins(only, ['https://gone.example']).rules).toEqual([])
  })

  it('leaves a rule that does not govern the signed PUT alone', () => {
    const mixed: CorsRule[] = [
      { origin: ['https://acme.example'], method: ['GET'] },
      ...rules,
    ]
    const result = revokeUploadOrigins(mixed, ['https://acme.example'])
    expect(result.rules[0]).toEqual({
      origin: ['https://acme.example'],
      method: ['GET'],
    })
    expect(result.removed).toEqual(['https://acme.example'])
  })
})

describe('uploadCorsRemedy', () => {
  it('names the origins and the read-modify-write shape', () => {
    const remedy = uploadCorsRemedy('aglyn-main.appspot.com', [
      'https://acme.example.com',
    ])
    expect(remedy).toContain('https://acme.example.com')
    expect(remedy).toContain('aglyn-main.appspot.com')
    // The instruction has to carry the warning, because the obvious command
    // is the destructive one.
    expect(remedy.toLowerCase()).toContain('replaces')
  })
})

describe('the committed policy (cloud/storage-cors.json)', () => {
  it('permits the console origin the platform serves the DAM from', () => {
    expect(permitsUploadOrigin(committedRules(), 'https://app.aglyn.com')).toBe(
      true,
    )
  })

  it('contains no wildcard origin', () => {
    // A ratchet, not a restatement: this is the one edit to that file that
    // must never pass review, and review is not a mechanism.
    expect(JSON.stringify(committedRules())).not.toContain('"*"')
  })
})
