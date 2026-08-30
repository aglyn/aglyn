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
 * MARKETING MAY NOT TAKE A CAMPAIGN SHAPE OUT OF THE EMAIL PLUGIN.
 *
 * Marketing and Email are independently toggleable: `release_marketing` and
 * `release_email` are separate flags in
 * `libs/aglyn/src/lib/plugin-manager/enabled-plugins.ts`, and Marketing's
 * `campaigns` console section carries no gate on the email plugin. Every
 * plugin nonetheless compiles into one console bundle, so an import across
 * that line resolves at runtime whether or not the Email plugin is enabled:
 * an organization with Marketing alone gets a campaign surface assembled out
 * of Email-plugin code, and nothing anywhere fails. The switchboard is simply
 * bypassed, silently.
 *
 * The shapes both plugins read — the campaign container, the rate math, the
 * revenue rollup, the message record and the figure renderers — live in
 * `@aglyn/shared-ui-email-campaigns`, which both depend on as peers. This
 * guard is what keeps them there.
 *
 * It is a SOURCE assertion, not a render or import test, because the defect
 * is which modules end up in the graph. A rendered campaign card passes
 * identically whether its `<Figure>` came from the shared lib or from a
 * plugin the org never enabled.
 *
 * ## Two checks, because there are two ways back across the line
 *
 * 1. A deep import of a module that moved
 *    (`@aglyn/plugins-email/model/campaign-report`, …). The paths no longer
 *    exist, so this catches a stale copy-paste rather than a live regression.
 * 2. A named import of a moved SYMBOL through the barrel
 *    `@aglyn/plugins-email/model`, which still re-exports the shared lib for
 *    the Email plugin's own callers and therefore still resolves. This is the
 *    live hole, and it is why the owned set below is read out of the shared
 *    library's source instead of being retyped here: a symbol that moves in
 *    either direction later moves in this guard with it.
 *
 * Imports of email BEHAVIOR — the composer, the send API, the topic
 * subscriptions — are outside what this asserts. Those are the Email plugin's
 * to govern, and gating them is a separate mechanism.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** `libs/plugins/marketing/src` — every source file this plugin ships. */
const MARKETING_SRC = join(__dirname, '..')

/** `libs/shared/ui/email-campaigns/src/lib` — the peer library's source. */
const SHARED_LIB = join(
  __dirname,
  '../../../../shared/ui/email-campaigns/src/lib',
)

/**
 * The modules that moved, by the path they used to answer to. Listed
 * explicitly because a stale path is not observable from the shared library:
 * once a module is gone from the Email plugin, only the string is left.
 */
const MOVED_ENTRY_POINTS = [
  '@aglyn/plugins-email/model/campaign-report',
  '@aglyn/plugins-email/model/campaign-revenue',
  '@aglyn/plugins-email/model/email-record',
  '@aglyn/plugins-email/model/campaign-container',
  '@aglyn/plugins-email/components/report-figures',
]

/** The shared library's source modules, in the order a reader meets them. */
const SHARED_SOURCES = [
  'model/campaign-container.ts',
  'model/campaign-report.ts',
  'model/campaign-revenue.ts',
  'model/email-record.ts',
  'components/report-figures.tsx',
]

/** Every `.ts`/`.tsx` file under a directory, specs included. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

/**
 * The names a module exports.
 *
 * Two forms cover this library: a declaration carrying `export`, and an
 * `export { … }` block (which `report-figures` and `campaign-revenue` both
 * use to pass a symbol through from another library — those are shared
 * definitions too, and reaching them through the Email plugin is the same
 * mistake). `as` renames export under the NEW name, which is the name an
 * importer would write.
 */
function exportedNames(source: string): string[] {
  const declared = [
    ...source.matchAll(
      /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm,
    ),
  ].map((match) => match[1])

  const passedThrough = [...source.matchAll(/^export\s*\{([^}]*)\}/gm)].flatMap(
    (match) => bindingNames(match[1], 'as-target'),
  )

  return [...declared, ...passedThrough]
}

/**
 * The identifiers inside an import/export brace list.
 *
 * `side` picks which half of `A as B` matters. An IMPORT names the module's
 * own symbol on the left; an EXPORT publishes the name on the right.
 */
function bindingNames(
  clause: string,
  side: 'as-source' | 'as-target',
): string[] {
  return clause
    .split(',')
    .map((part) => part.replace(/\btype\s+/, '').trim())
    .filter(Boolean)
    .map((part) => {
      const renamed = part.split(/\s+as\s+/)
      if (renamed.length < 2) return part
      return side === 'as-source' ? renamed[0].trim() : renamed[1].trim()
    })
    .filter((name) => /^[A-Za-z0-9_$]+$/.test(name))
}

/** One `import`/`export … from '<specifier>'` statement found in a file. */
interface ModuleReference {
  file: string
  specifier: string
  /** The names taken from that module — empty for a side-effect import. */
  names: string[]
}

/**
 * Every statement in `source` that pulls from a `@aglyn/plugins-email…`
 * module.
 *
 * Walked line by line rather than matched as one regex over the file: import
 * clauses here span several lines and carry no terminating semicolon, so a
 * lazy whole-file pattern happily swallows the statement above the one it
 * matched and reports its bindings against the wrong module.
 */
function emailPluginReferences(
  file: string,
  source: string,
): ModuleReference[] {
  const lines = source.split('\n')
  const references: ModuleReference[] = []

  lines.forEach((line, index) => {
    const from = /from\s+'(@aglyn\/plugins-email[^']*)'/.exec(line)
    if (!from) return

    let start = index
    while (start > 0 && !/^\s*(?:import|export)\b/.test(lines[start])) start--

    const clause = lines.slice(start, index + 1).join('\n')
    const braced = /\{([\s\S]*)\}/.exec(clause)

    references.push({
      file,
      specifier: from[1],
      names: braced ? bindingNames(braced[1], 'as-source') : [],
    })
  })

  return references
}

const OWNED_BY_SHARED_LIB = new Set(
  SHARED_SOURCES.flatMap((relative) =>
    exportedNames(readFileSync(join(SHARED_LIB, relative), 'utf8')),
  ),
)

const MARKETING_FILES = sourceFiles(MARKETING_SRC)

const EMAIL_PLUGIN_REFERENCES = MARKETING_FILES.flatMap((file) =>
  emailPluginReferences(file, readFileSync(file, 'utf8')),
)

/** Paths read back short, so a failure names the file and not the machine. */
const short = (file: string) => file.slice(file.indexOf('libs/'))

describe('the boundary this guard is reading', () => {
  /*
   * A static guard that silently scans nothing passes forever. Both halves of
   * the input get a known-present control before anything is asserted about
   * what is absent.
   */

  it('found the shared library and read real symbols out of it', () => {
    expect(OWNED_BY_SHARED_LIB.size).toBeGreaterThan(40)
    // One from each source module, and both export forms.
    expect([...OWNED_BY_SHARED_LIB]).toEqual(
      expect.arrayContaining([
        'CAMPAIGN_SEND_CONTAINER_FIELD',
        'campaignReport',
        'CampaignStats',
        'campaignRevenueReport',
        'emailSendTimeMs',
        'MoneyPerMessageRow',
        'Figure',
        'RateRow',
        'Section',
      ]),
    )
  })

  it('found marketing sources that do reach the email plugin', () => {
    expect(MARKETING_FILES.length).toBeGreaterThan(20)
    expect(EMAIL_PLUGIN_REFERENCES.length).toBeGreaterThan(0)
  })
})

describe('marketing does not reach into the email plugin for campaign shapes', () => {
  it('imports no module that moved to the shared library', () => {
    const stale = EMAIL_PLUGIN_REFERENCES.filter((reference) =>
      MOVED_ENTRY_POINTS.includes(reference.specifier),
    ).map((reference) => `${short(reference.file)} → ${reference.specifier}`)

    expect(stale).toEqual([])
  })

  it('takes no symbol the shared library owns through the email barrel', () => {
    const borrowed = EMAIL_PLUGIN_REFERENCES.flatMap((reference) =>
      reference.names
        .filter((name) => OWNED_BY_SHARED_LIB.has(name))
        .map(
          (name) =>
            `${short(reference.file)} imports ${name} from ${reference.specifier}`,
        ),
    )

    expect(borrowed).toEqual([])
  })
})
