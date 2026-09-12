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
 * British spellings in customer-facing copy (AGL-2763).
 *
 * The standing rule is American spelling on every customer-facing surface —
 * docs, the marketing site, console UI strings. It was stated after a batch of
 * drafts mixed `colour`/`centre` with `organization`/`analytics` in the same
 * breath, which is the signature of unconstrained locale drift rather than a
 * choice. Nothing mechanical enforced it, so the drift came back: a sweep a
 * fortnight later found `colour` still in the Besigner styling pages, and one
 * of those was a HEADING, whose anchor had already been baked into two
 * generated console registries.
 *
 * ## The boundary this detector has to respect
 *
 * The rule names two things it must NOT touch, and both are load-bearing:
 *
 *  1. **Code comments.** Cosmetic, not customer-facing, not worth the diff
 *     noise. `apps/console` alone carries ~179 occurrences of `colour` in
 *     comments and identifiers (`AVATAR_COLOURS`, `assignRoomColours`), none
 *     of which a reader of the product ever sees. A grep-based guard would
 *     report every one of them and be switched off the same day.
 *  2. **Persisted string values.** An order's `status: 'cancelled'` is a
 *     schema, not a spelling — changing it is a migration. The console already
 *     does the right thing here and the docs record it: the stored value stays
 *     `cancelled` while the display label beside it reads *Canceled*.
 *
 * ## The one thing it cannot see
 *
 * A string literal's CONTENT says nothing about the role of the key above it.
 * `marketplace-sections.ts` holds both shapes two lines apart:
 *
 *     { id: 'licences', label: 'Licences', route: Route.ORG_MARKETPLACE_LICENCES }
 *
 * `label` is copy and should read *Licenses*; `id` is a section identifier
 * bound to a route segment and a checkout mapping, and Americanising it is a
 * URL change wearing a spell check. Both are `StringLiteral`s and no amount of
 * parsing separates them, which is the honest limit of this detector and the
 * strongest single argument for the ratchet: the baseline RECORDS such a line
 * rather than demanding it change, and the guard prints file, line and word so
 * whoever reads a red can tell the two apart in a second.
 *
 * So copy is identified STRUCTURALLY, not by pattern. Source files go through
 * `copy-spans.mjs`, which yields string literals and JSX text and never a
 * comment. Markdown is masked first, which blanks fenced blocks, inline code
 * and link targets — and that mask is what keeps `| ``cancelled`` | Canceled |`
 * from being read as a spelling error when it is an API value being
 * documented.
 *
 * ## Why the word list is explicit and not a rule
 *
 * The tempting rule is `-ise` → `-ize`. It is wrong: `advertise`, `exercise`,
 * `franchise`, `enterprise`, `merchandise`, `supervise`, `comprise`,
 * `promise` and `surprise` are all American as written. Every entry below is
 * a word whose American form actually differs, so a hit is a hit.
 */

import { copySpans, lineOf } from './copy-spans.mjs'

/**
 * British → American.
 *
 * Deliberately ABSENT, having been checked rather than assumed:
 *
 *  - `cancellation` — American too. The single-l `cancelation` is the rare
 *    variant, so listing it would have manufactured 12 false positives in
 *    `apps/docs` on its own.
 *  - `dialogue`, `towards`, `burnt`, `leapt` — standard in American English.
 *  - `catalogue` IS listed (American prefers `catalog`) but `dialogue` is not;
 *    the two look like a pair and are not one.
 */
export const BRITISH_SPELLINGS = {
  // -our
  colour: 'color', colours: 'colors', coloured: 'colored', colouring: 'coloring',
  behaviour: 'behavior', behaviours: 'behaviors',
  favour: 'favor', favours: 'favors', favourite: 'favorite', favourites: 'favorites',
  honour: 'honor', honours: 'honors', honoured: 'honored',
  labour: 'labor', neighbour: 'neighbor', neighbours: 'neighbors',
  flavour: 'flavor', flavours: 'flavors', humour: 'humor', rumour: 'rumor',
  endeavour: 'endeavor', savour: 'savor', vapour: 'vapor', armour: 'armor',
  harbour: 'harbor', odour: 'odor', parlour: 'parlor', candour: 'candor',
  splendour: 'splendor', demeanour: 'demeanor', saviour: 'savior',
  // -re
  centre: 'center', centres: 'centers', centred: 'centered', centring: 'centering',
  theatre: 'theater', metre: 'meter', metres: 'meters', litre: 'liter',
  fibre: 'fiber', calibre: 'caliber', sombre: 'somber', manoeuvre: 'maneuver',
  // -ise / -isation
  organise: 'organize', organised: 'organized', organises: 'organizes',
  organising: 'organizing', organisation: 'organization', organisations: 'organizations',
  realise: 'realize', realised: 'realized', realises: 'realizes', realising: 'realizing',
  recognise: 'recognize', recognised: 'recognized', recognises: 'recognizes',
  recognising: 'recognizing', customise: 'customize', customised: 'customized',
  customises: 'customizes', customising: 'customizing',
  optimise: 'optimize', optimised: 'optimized', optimising: 'optimizing',
  minimise: 'minimize', minimised: 'minimized', maximise: 'maximize', maximised: 'maximized',
  prioritise: 'prioritize', prioritised: 'prioritized',
  normalise: 'normalize', normalised: 'normalized',
  initialise: 'initialize', initialised: 'initialized', initialising: 'initializing',
  serialise: 'serialize', serialised: 'serialized',
  authorise: 'authorize', authorised: 'authorized', authorisation: 'authorization',
  unauthorised: 'unauthorized', personalise: 'personalize', personalised: 'personalized',
  synchronise: 'synchronize', synchronised: 'synchronized',
  emphasise: 'emphasize', emphasised: 'emphasized',
  summarise: 'summarize', summarised: 'summarized',
  categorise: 'categorize', categorised: 'categorized',
  standardise: 'standardize', standardised: 'standardized',
  visualise: 'visualize', visualised: 'visualized',
  utilise: 'utilize', utilised: 'utilized', apologise: 'apologize',
  analyse: 'analyze', analysed: 'analyzed', analysing: 'analyzing', paralyse: 'paralyze',
  // -ce / -og / doubled l
  licence: 'license', licences: 'licenses', defence: 'defense', offence: 'offense',
  pretence: 'pretense', practise: 'practice',
  catalogue: 'catalog', catalogues: 'catalogs',
  fulfil: 'fulfill', fulfils: 'fulfills', instalment: 'installment',
  instalments: 'installments', enrol: 'enroll', enrols: 'enroll',
  skilful: 'skillful', wilful: 'willful',
  travelled: 'traveled', travelling: 'traveling', labelled: 'labeled',
  labelling: 'labeling', modelled: 'modeled', modelling: 'modeling',
  signalled: 'signaled', cancelled: 'canceled', cancelling: 'canceling',
  // miscellaneous
  judgement: 'judgment', acknowledgement: 'acknowledgment',
  acknowledgements: 'acknowledgments', ageing: 'aging',
  enquiry: 'inquiry', enquiries: 'inquiries', artefact: 'artifact',
  artefacts: 'artifacts', sceptical: 'skeptical', mould: 'mold',
  storey: 'story', tyre: 'tire', aluminium: 'aluminum', sulphur: 'sulfur',
  pyjamas: 'pajamas', cosy: 'cozy', speciality: 'specialty',
  aeroplane: 'airplane', programme: 'program', programmes: 'programs',
  whilst: 'while', amongst: 'among', learnt: 'learned', spelt: 'spelled',
  spoilt: 'spoiled', grey: 'gray', greyed: 'grayed', greyscale: 'grayscale',
}

/**
 * Words that name a VALUE rather than describe anything, and so are scanned in
 * markdown prose but never in source.
 *
 * The rule's own carve-out: `status: 'cancelled'` is an order state shared with
 * Stripe and persisted in Firestore, and `'grey'` in a `sx` prop is an MUI
 * palette key (`grey.500`) — a token defined by the library, not a word we
 * chose. Flagging either would ask an author to make a breaking change to
 * satisfy a spell check, which is how a gate earns its reputation and stops
 * being read. In markdown they stay in scope because the mask has already
 * removed the code spans that carry them as values, so what is left really is
 * prose.
 */
export const DATA_VALUED = new Set([
  'cancelled', 'cancelling', 'grey', 'greyed', 'greyscale',
])

const WORD_RE = new RegExp(
  `\\b(${Object.keys(BRITISH_SPELLINGS).join('|')})\\b`,
  'gi',
)

/** Blank a run of text, keeping newlines so later offsets still line up. */
function blank(text) {
  return text.replace(/[^\n]/g, ' ')
}

/**
 * Replace every non-prose region of a markdown file with spaces of the same
 * length, so line numbers survive and the scanner sees only prose.
 *
 * The order matters. Fenced blocks go first because their bodies routinely
 * contain unbalanced backticks that would otherwise desynchronise the inline
 * pass — the same failure mode that produced false greens in the brand
 * detector's hand-rolled scanner, which is why this masks rather than deletes.
 */
export function maskMarkdown(source) {
  let out = source
  // Fenced code blocks, ``` or ~~~, including the fence lines themselves.
  out = out.replace(/^([ \t]*)(```+|~~~+)[^\n]*\n[\s\S]*?^[ \t]*\2[^\n]*$/gm, blank)
  // An unterminated fence runs to the end of the file.
  out = out.replace(/^([ \t]*)(```+|~~~+)[^\n]*\n[\s\S]*$/m, blank)
  // HTML/MDX comments.
  out = out.replace(/<!--[\s\S]*?-->/g, blank)
  out = out.replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
  // Inline code, longest fences first so ``a `b` c`` is one span.
  out = out.replace(/(`+)(?:(?!\1)[\s\S])*\1/g, blank)
  // Link and image DESTINATIONS — `](/img/colour-picker.png)` is a filename.
  out = out.replace(/\]\([^)\n]*\)/g, blank)
  // Reference definitions and bare URLs.
  out = out.replace(/^\s*\[[^\]\n]+\]:[^\n]*$/gm, blank)
  out = out.replace(/https?:\/\/\S+/g, blank)
  // Frontmatter keys that are identifiers rather than copy.
  out = out.replace(/^(?:id|slug|sidebar_\w+|tags|image|hide_\w+):[^\n]*$/gm, blank)
  return out
}

function suggestionFor(match) {
  const american = BRITISH_SPELLINGS[match.toLowerCase()]
  if (match === match.toUpperCase()) return american.toUpperCase()
  if (match[0] === match[0].toUpperCase())
    return american[0].toUpperCase() + american.slice(1)
  return american
}

function scan(text, lineAt, skip) {
  const found = []
  for (const m of text.matchAll(WORD_RE)) {
    const word = m[0]
    if (skip?.has(word.toLowerCase())) continue
    found.push({
      line: lineAt(m.index),
      word,
      suggestion: suggestionFor(word),
      text: text
        .slice(Math.max(0, m.index - 50), m.index + word.length + 50)
        .replace(/\s+/g, ' ')
        .trim(),
    })
  }
  return found
}

/** British spellings in a markdown file's prose. */
export function findInMarkdown(source) {
  const masked = maskMarkdown(source)
  // A prefix line index beats counting newlines per match on a 1,400-line page.
  const starts = [0]
  for (let i = 0; i < masked.length; i++)
    if (masked[i] === '\n') starts.push(i + 1)
  const lineAt = (pos) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  return scan(masked, lineAt).sort((a, b) => a.line - b.line)
}

/**
 * A URL inside a string literal is somebody else's path, not our copy.
 *
 * `member-state-exposure.ts` links the Irish DPC and the UK ICO breach-report
 * pages, whose paths are literally `/en/organisations/` and
 * `/for-organisations/`. Americanising either is a 404, not a copy fix — the
 * spelling belongs to the regulator's site. Blanked rather than cut so the
 * offsets around them still name the right line.
 *
 * Markdown gets this for free in `maskMarkdown`; a string literal needs it
 * said again because the parser hands over the whole literal.
 */
function maskUrls(text) {
  return text.replace(/https?:\/\/\S+/g, blank)
}

/** British spellings in a source file's user-visible copy. */
export function findInSource(source, path = 'source.tsx') {
  const { file, spans } = copySpans(source, path)
  const found = []
  for (const { text, start } of spans)
    found.push(
      ...scan(maskUrls(text), (pos) => lineOf(file, start + pos), DATA_VALUED),
    )
  return found.sort((a, b) => a.line - b.line)
}

export { compareToBaseline } from './ratchet-baseline.mjs'
