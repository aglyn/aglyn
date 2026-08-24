#!/usr/bin/env node
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
 * Every storefront charge keeps the shape the Terms now describe (AGL-1956).
 *
 * ```
 * npm run check:facilitator-charge-shape
 * node tools/scripts/check-facilitator-charge-shape.mjs --json
 * node tools/scripts/check-facilitator-charge-shape.mjs --self-test
 * ```
 *
 * ## Why this is an exit code and not a comment
 *
 * On 2026-08-24 Aglyn accepted marketplace-facilitator status and published
 * ToS §10.7, which tells every merchant that on a storefront sale the tax "is
 * collected into Aglyn's processor account, is not transferred to your
 * connected payment account, and is remitted by Aglyn to the taxing
 * authority." That sentence is not a description of a policy. It is a
 * description of FOUR PARAMETERS on a Stripe request, and nothing in this
 * repository checked that they stay that way.
 *
 * The money defect AGL-1956 closed was created by exactly one wrong parameter
 * choice — `application_fee_amount` beside `automatic_tax[enabled]` on a
 * destination charge — and it survived months of review because it is
 * invisible: both keys are individually correct, the session is created, the
 * shopper is charged the right total, and the only wrong thing is which
 * balance the sales tax lands in. Every downstream number stays plausible. A
 * unit test on any single call site cannot see it either, because the defect
 * is a RELATIONSHIP between two keys.
 *
 * The AGL-1956 close-out then recorded, accurately, that five of the charge
 * sites hand-roll their Connect parameters rather than calling the one
 * emitter, "so that module's claim to be the single emitter is not true of the
 * codebase", and that a guard was warranted but not built. This is that guard.
 * A note in a comment cannot fail; this can.
 *
 * ## The four invariants
 *
 * **1. Settlement stays on Aglyn's platform account.** No money-collecting
 * request may carry `on_behalf_of` or a `Stripe-Account` header. Either one
 * moves the settlement account — and with it the merchant of record, the
 * statement descriptor and the Stripe Tax liability party — onto the connected
 * account. That is a DIRECT charge, it is a different legal posture from the
 * one §10.7 states, and it would silently make the published Terms false.
 * Whether Aglyn should eventually move to direct charges is a real open
 * question (AGL-1794); drifting there one call site at a time, without the
 * Terms moving with it, is not how it should happen.
 *
 * **2. Stripe Tax and the fee form never meet.** A file that sets
 * `automatic_tax[enabled]` may not also emit
 * `payment_intent_data[application_fee_amount]`. On a destination charge the
 * fee form makes Stripe transfer `amount_total − fee` to the merchant, and
 * `amount_total` has Aglyn's sales tax inside it — so the fee form gives the
 * state's money away on every taxed sale. This is the AGL-1956 defect itself,
 * stated as a rule. The correct form when Aglyn owes the tax is a fixed
 * `transfer_data[amount]`, which `destinationChargeParams` emits.
 *
 * **3. The single-emitter claim is true, or the exception is written down.**
 * Any file emitting a literal `transfer_data[destination]` must either be the
 * shared emitter or appear in `HAND_ROLLED` below with the reason it is
 * correct. Most entries are correct for the same reason — they charge only
 * merchant-owned tax, so the fee form is exact there — which is why an
 * allowlisted file that GAINS `automatic_tax[enabled]` fails unless it also
 * pins the transfer, either with a literal `transfer_data[amount]` or by
 * calling the shared emitter. The allowlist forgives hand-rolling, never the
 * leak.
 *
 * **5. A Stripe Tax path stays in USD.** Measured read-only against the TEST
 * platform account on 2026-08-24: `GET /v1/tax/settings` returns
 * `defaults.tax_behavior: "inferred_by_currency"`, NOT `exclusive`. For USD
 * that infers EXCLUSIVE — tax added on top — which is what ToS §10.7 promises
 * the merchant: tax "is added to the amount the End User pays rather than
 * taken out of it", and "your share of the sale, and our platform transaction
 * fee, are calculated on the pre-tax price".
 *
 * Every commerce line item hardcodes `'usd'` today, so the inference is
 * correct everywhere. It is not correct by CONSTRUCTION. The day a storefront
 * bills in a currency whose home jurisdiction quotes tax-inclusive prices,
 * Stripe infers INCLUSIVE, and two things break at once and silently: §10.7
 * becomes false, and `platformLiableTransferCents` — which computes
 * `goods + shipping − fee` on the assumption the tax sits ON TOP — hands the
 * whole tax back to the merchant, reopening the exact defect invariant 2
 * exists to prevent. Nothing else in the repository would notice.
 *
 * The durable fix is to pin `tax_behavior: exclusive` per line item, which
 * `marketplace/checkout.ts:371` already does and commerce does not. Until
 * that lands, this keeps the assumption the arithmetic rests on honest.
 *
 * **4. The subscription safety net stays wired.** `checkout.ts` gates
 * `destinationChargeParams` on `!isSubscription` but does NOT gate
 * `automatic_tax`, because a Stripe Subscription accepts no
 * `transfer_data[amount]` — only `application_fee_percent`, which applies to
 * the whole invoice including tax. The recurring path therefore over-transfers
 * BY DESIGN and is corrected afterwards by a transfer reversal on
 * `invoice.paid`. That reversal is not an optimisation; it is the only thing
 * standing between a taxed subscription cycle and the merchant keeping 100% of
 * Aglyn's tax. Deleting it would break nothing that any other test can see, so
 * this asserts it is still called.
 *
 * ## Reading code and not prose
 *
 * `on_behalf_of` and `Stripe-Account` are discussed at length in this
 * repository's comments — that is the POINT of those comments, and they are
 * exactly the strings this guard hunts. So the scanner strips comments and
 * string-literal contents are matched only where a literal is real code. A
 * guard that could not tell a parameter from a sentence about a parameter
 * would either fire on every explanatory comment or be silenced into
 * uselessness.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const asJson = process.argv.includes('--json')
const selfTest = process.argv.includes('--self-test')

/** The one module allowed to decide the split. */
const EMITTER = 'libs/plugins/commerce/src/lib/model/commerce-connect-transfer.ts'

/** Where the `invoice.paid` reversal must still be called from. */
const REVERSAL_CALLER = 'libs/plugins/commerce/src/lib/server/billing-webhook.ts'
const REVERSAL_FN = 'subscriptionInvoiceTaxReversal'

/**
 * Charge sites that build their own Connect parameters, and why each is
 * correct without the shared emitter.
 *
 * Every entry charges only tax the MERCHANT owns — a flat rate the merchant
 * typed, or no tax at all — so `application_fee_amount` is exact for it: the
 * variable part of the charge is the merchant's own money and may stay with
 * them. None of them sets `automatic_tax`, and invariant 3 fails any that
 * starts to.
 */
const HAND_ROLLED = new Map([
  [
    'libs/plugins/commerce/src/lib/server/pos-order.ts',
    'An in-person till has no shopper address, so a Stripe Tax store cannot ' +
      'complete a POS sale at all (409, AGL-2145). POS tax is therefore ' +
      'always the merchant-configured flat rate, and the fee form is what the ' +
      'correct branch of the shared emitter would return anyway.',
  ],
  [
    'libs/plugins/commerce/src/lib/server/reserve.ts',
    'A reservation charges the merchant-configured lodging rate as an ' +
      'ordinary line item. `automatic_tax` would compute a GOODS rate on a ' +
      'room, which is why it is deliberately absent (AGL-1969).',
  ],
  [
    'libs/plugins/bookings/src/lib/server.ts',
    'A paid service booking carries the merchant-configured service rate as ' +
      'an ordinary line item and sets no `automatic_tax` by a stated decision.',
  ],
  [
    'libs/plugins/marketplace/src/lib/server/checkout.ts',
    'The marketplace found this same trap first (AGL-1544) and closed it with ' +
      'a FIXED `transfer_data[amount]` and no application fee. Verified below ' +
      'rather than trusted: this entry is void if the fixed transfer goes.',
  ],
  [
    'libs/plugins/commerce/src/lib/server/checkout.ts',
    'The one-off arm calls the shared emitter. The SUBSCRIPTION arm cannot — ' +
      'a Stripe Subscription accepts no `transfer_data[amount]`, only ' +
      '`application_fee_percent` — so it hand-rolls ' +
      '`subscription_data[transfer_data][destination]` and is corrected after ' +
      'the fact by the reversal invariant 4 pins.',
  ],
])

/**
 * The file that must keep a fixed `transfer_data[amount]` for its HAND_ROLLED
 * entry to hold, because that entry's stated reason IS the fixed transfer.
 */
const FIXED_TRANSFER_REQUIRED = new Set([
  'libs/plugins/marketplace/src/lib/server/checkout.ts',
])

/**
 * Strip comments, keeping every other byte at its original offset so line
 * numbers survive. A single left-to-right scan with five states; string
 * bodies are preserved because a Stripe parameter key IS a string literal.
 *
 * The one construct this does not model is a regex literal, which can contain
 * an unbalanced quote or `//`. That is a false-POSITIVE risk, never a false
 * negative — a mis-scanned region can only make the guard shout, and the
 * self-test covers the shapes that actually occur here.
 */
export function stripComments(source) {
  const out = []
  let state = 'code'
  let quote = ''
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line'
        out.push(' ', ' ')
        i += 1
        continue
      }
      if (ch === '/' && next === '*') {
        state = 'block'
        out.push(' ', ' ')
        i += 1
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        state = 'string'
        quote = ch
      }
      out.push(ch)
      continue
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code'
        out.push(ch)
        continue
      }
      out.push(' ')
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code'
        out.push(' ', ' ')
        i += 1
        continue
      }
      out.push(ch === '\n' ? '\n' : ' ')
      continue
    }
    // string
    if (ch === '\\') {
      out.push(ch, next ?? '')
      i += 1
      continue
    }
    if (ch === quote) {
      state = 'code'
      quote = ''
    }
    out.push(ch)
  }
  return out.join('')
}

/** Every match of `needle` in comment-stripped code, as `{ line, text }`. */
function hits(code, needle) {
  const found = []
  let from = 0
  for (;;) {
    const at = code.indexOf(needle, from)
    if (at < 0) return found
    found.push({
      line: code.slice(0, at).split('\n').length,
      text: code
        .slice(code.lastIndexOf('\n', at) + 1, code.indexOf('\n', at))
        .trim(),
    })
    from = at + needle.length
  }
}

/** Tracked TypeScript that is not a test. */
function chargeSources() {
  return execFileSync('git', ['ls-files', 'libs', 'apps'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((path) => /\.tsx?$/.test(path))
    .filter((path) => !/\.spec\.tsx?$/.test(path))
}

/**
 * The four invariants, over one already-stripped file. Split out from the
 * filesystem walk so `--self-test` can drive it with fixtures.
 */
export function inspect(path, code) {
  const problems = []
  const emitsDestination =
    hits(code, 'transfer_data][destination]').length > 0 ||
    hits(code, 'transfer_data[destination]').length > 0
  const enablesStripeTax = hits(code, 'automatic_tax[enabled]').length > 0
  const emitsFeeAmount = hits(code, 'application_fee_amount]').length > 0
  const emitsFixedTransfer = hits(code, 'transfer_data][amount]').length > 0
  // Delegating to the shared emitter IS pinning the transfer — it is the
  // whole point of the emitter. `checkout.ts` reaches it for its one-off arm
  // while hand-rolling the subscription arm beside it, so a file can be both
  // a caller and a hand-roller and still be correct.
  const delegates = hits(code, 'destinationChargeParams(').length > 0
  const pinsTransfer = emitsFixedTransfer || delegates

  // 1. Settlement stays on the platform account.
  for (const needle of ['on_behalf_of', 'Stripe-Account']) {
    for (const hit of hits(code, needle)) {
      problems.push({
        invariant: 1,
        path,
        line: hit.line,
        message:
          `${needle} appears in CODE. That moves settlement onto the ` +
          'connected account — a direct charge — and ToS §10.7 tells every ' +
          'merchant the tax is collected into Aglyn’s account and ' +
          'remitted by Aglyn. Moving the charge model is an AGL-1794 ' +
          'decision that the Terms have to move with.',
        evidence: hit.text,
      })
    }
  }

  // 2. Stripe Tax and the fee form never meet.
  if (enablesStripeTax && emitsFeeAmount) {
    problems.push({
      invariant: 2,
      path,
      line: hits(code, 'application_fee_amount]')[0].line,
      message:
        'sets automatic_tax[enabled] AND application_fee_amount. On a ' +
        'destination charge the fee form transfers `amount_total − fee`, and ' +
        'amount_total INCLUDES the Stripe Tax that Aglyn is registered to ' +
        'remit — so every taxed sale wires the state’s money to the ' +
        'merchant. Use destinationChargeParams, which fixes the TRANSFER.',
      evidence: hits(code, 'application_fee_amount]')[0].text,
    })
  }

  // 3. One emitter, or a written-down exception.
  if (emitsDestination && path !== EMITTER) {
    const reason = HAND_ROLLED.get(path)
    if (!reason) {
      problems.push({
        invariant: 3,
        path,
        line: hits(code, 'transfer_data][destination]')[0]?.line ?? 1,
        message:
          'hand-rolls transfer_data[destination] without an entry in ' +
          'HAND_ROLLED. Call destinationChargeParams, or add an entry to ' +
          'this guard stating why the fee form is exact for this path.',
        evidence: hits(code, 'transfer_data][destination]')[0]?.text ?? '',
      })
    } else if (enablesStripeTax && !pinsTransfer) {
      problems.push({
        invariant: 3,
        path,
        line: hits(code, 'automatic_tax[enabled]')[0].line,
        message:
          'is allowlisted in HAND_ROLLED on the stated ground that it charges ' +
          'only merchant-owned tax, and it now enables Stripe Tax without a ' +
          'fixed transfer_data[amount]. The allowlist forgives hand-rolling, ' +
          'never the leak — its reason no longer holds.',
        evidence: hits(code, 'automatic_tax[enabled]')[0].text,
      })
    }
  }
  // 5. A Stripe Tax path stays in USD, because the platform account infers
  // tax behaviour FROM the currency and the transfer arithmetic assumes the
  // tax sits on top. See the module note.
  if (enablesStripeTax) {
    for (const hit of hits(code, 'price_data][currency]')) {
      // `hits` returns the whole source line, and every emission of this key
      // in the repo states its value on that same line — both the object-
      // literal form and the `params.set(\`…\`, 'usd')` form.
      if (!/['"`]usd['"`]/i.test(hit.text)) {
        problems.push({
          invariant: 5,
          path,
          line: hit.line,
          message:
            'enables Stripe Tax on a line item whose currency is not a ' +
            'literal usd. The platform account sets tax_behavior ' +
            '"inferred_by_currency", so a tax-inclusive currency makes ' +
            'Stripe take the tax OUT of the price — which makes ToS §10.7 ' +
            'false and makes platformLiableTransferCents hand the whole tax ' +
            'to the merchant. Pin tax_behavior: exclusive per line item ' +
            '(marketplace/checkout.ts already does) before billing in one.',
          evidence: hit.text,
        })
      }
    }
  }

  if (FIXED_TRANSFER_REQUIRED.has(path) && !emitsFixedTransfer) {
    problems.push({
      invariant: 3,
      path,
      line: 1,
      message:
        'is allowlisted BECAUSE it pins a fixed transfer_data[amount], and it ' +
        'no longer emits one. Aglyn owes the tax on these sales (AGL-1544).',
      evidence: '',
    })
  }

  return { path, problems, emitsDestination, enablesStripeTax, emitsFeeAmount }
}

/** Invariant 4 is about a call surviving, not about one file's shape. */
function reversalWired(files) {
  const found = files.find((file) => file.path === REVERSAL_CALLER)
  if (!found) return `${REVERSAL_CALLER} is missing`
  return reversalWiredProbe(found.path, found.code)
}

/** Invariant 4 over one already-stripped file, for `--self-test` and callers. */
export function reversalWiredProbe(path, code) {
  if (path !== REVERSAL_CALLER) return null
  return hits(code, `${REVERSAL_FN}(`).length > 0
    ? null
    : `${REVERSAL_CALLER} no longer calls ${REVERSAL_FN}(). checkout.ts ` +
        'enables Stripe Tax on subscriptions but cannot fix their transfer, ' +
        'so this reversal is the only thing that keeps Aglyn’s tax out ' +
        'of the merchant’s balance on every taxed cycle.'
}

// ---------------------------------------------------------------- self-test

/**
 * Each invariant is driven to a failure it should catch, and to a
 * near-miss it must NOT catch. A guard nobody has seen fail is a guard
 * nobody has tested.
 */
function runSelfTest() {
  let failures = 0
  const ok = (label, condition) => {
    console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}`)
    if (!condition) failures += 1
  }

  const only = (source, invariant, path = 'libs/x.ts') =>
    inspect(path, stripComments(source)).problems.filter(
      (problem) => problem.invariant === invariant,
    )

  // The scanner itself: prose about a parameter is not a parameter.
  ok(
    'a comment naming on_behalf_of is NOT a violation',
    only("// no `on_behalf_of`, no Stripe-Account header\nconst a = 1\n", 1)
      .length === 0,
  )
  ok(
    'a block comment naming on_behalf_of is NOT a violation',
    only(" /**\n  * with no `on_behalf_of` and no `Stripe-Account`.\n  */\n", 1)
      .length === 0,
  )
  ok(
    "an apostrophe in a comment does not swallow the file",
    only(
      "// That is the PLATFORM's charge.\nconst p = { on_behalf_of: acct }\n",
      1,
    ).length === 1,
  )
  ok(
    'a real on_behalf_of parameter IS a violation',
    only("params.set('payment_intent_data[on_behalf_of]', acct)\n", 1).length ===
      1,
  )
  ok(
    'a real Stripe-Account header IS a violation',
    only("headers: { 'Stripe-Account': accountId }\n", 1).length === 1,
  )

  // Invariant 2 — the AGL-1956 defect itself.
  ok(
    'Stripe Tax beside application_fee_amount IS a violation',
    only(
      "const p = {\n 'automatic_tax[enabled]': 'true',\n" +
        " 'payment_intent_data[application_fee_amount]': String(fee),\n}\n",
      2,
    ).length === 1,
  )
  ok(
    'application_fee_amount ALONE is not a violation',
    only("const p = { 'payment_intent_data[application_fee_amount]': f }\n", 2)
      .length === 0,
  )
  ok(
    'Stripe Tax with a FIXED transfer is not a violation',
    only(
      "const p = {\n 'automatic_tax[enabled]': 'true',\n" +
        " 'payment_intent_data[transfer_data][amount]': String(net),\n}\n",
      2,
    ).length === 0,
  )

  // Invariant 3 — the single-emitter claim.
  ok(
    'an unlisted new charge site IS a violation',
    only(
      "const p = { 'payment_intent_data[transfer_data][destination]': a }\n",
      3,
      'libs/plugins/commerce/src/lib/server/brand-new-checkout.ts',
    ).length === 1,
  )
  ok(
    'an allowlisted site that gains Stripe Tax IS a violation',
    only(
      "const p = {\n 'payment_intent_data[transfer_data][destination]': a,\n" +
        " 'automatic_tax[enabled]': 'true',\n}\n",
      3,
      'libs/plugins/commerce/src/lib/server/pos-order.ts',
    ).length === 1,
  )
  ok(
    'an allowlisted site that gains Stripe Tax but DELEGATES is not',
    only(
      "const p = {\n 'payment_intent_data[transfer_data][destination]': a,\n" +
        " 'automatic_tax[enabled]': 'true',\n" +
        ' ...destinationChargeParams(split),\n}\n',
      3,
      'libs/plugins/commerce/src/lib/server/checkout.ts',
    ).length === 0,
  )
  ok(
    'that same site LOSING the delegation IS a violation',
    only(
      "const p = {\n 'payment_intent_data[transfer_data][destination]': a,\n" +
        " 'automatic_tax[enabled]': 'true',\n}\n",
      3,
      'libs/plugins/commerce/src/lib/server/checkout.ts',
    ).length === 1,
  )
  ok(
    'an allowlisted site WITHOUT Stripe Tax is not a violation',
    only(
      "const p = { 'payment_intent_data[transfer_data][destination]': a }\n",
      3,
      'libs/plugins/commerce/src/lib/server/pos-order.ts',
    ).length === 0,
  )
  ok(
    'the marketplace losing its fixed transfer IS a violation',
    only(
      "const p = { 'payment_intent_data[transfer_data][destination]': a }\n",
      3,
      'libs/plugins/marketplace/src/lib/server/checkout.ts',
    ).length === 1,
  )

  // Invariant 5 — the currency the tax behaviour is inferred from.
  ok(
    'Stripe Tax on a non-USD line item IS a violation',
    only(
      "const p = {\n 'automatic_tax[enabled]': 'true',\n" +
        " 'line_items[0][price_data][currency]': 'eur',\n}\n",
      5,
    ).length === 1,
  )
  ok(
    'Stripe Tax on a usd line item is not a violation',
    only(
      "const p = {\n 'automatic_tax[enabled]': 'true',\n" +
        " 'line_items[0][price_data][currency]': 'usd',\n}\n",
      5,
    ).length === 0,
  )
  ok(
    'the template-literal spelling of a usd line item is not a violation',
    only(
      "params.set('automatic_tax[enabled]', 'true')\n" +
        'params.set(`line_items[${i}][price_data][currency]`, \'usd\')\n',
      5,
    ).length === 0,
  )
  ok(
    'a non-USD line item WITHOUT Stripe Tax is not a violation',
    only("const p = { 'line_items[0][price_data][currency]': 'eur' }\n", 5)
      .length === 0,
  )

  // Invariant 4.
  ok(
    'a billing-webhook without the reversal call IS a violation',
    reversalWired([{ path: REVERSAL_CALLER, code: 'const x = 1\n' }]) !== null,
  )
  ok(
    'a billing-webhook that calls the reversal is not',
    reversalWired([
      { path: REVERSAL_CALLER, code: `const d = ${REVERSAL_FN}(invoice)\n` },
    ]) === null,
  )

  console.log('')
  console.log(
    failures === 0
      ? 'Self-test passed: every invariant catches its own violation.'
      : `${failures} self-test failure(s) — the guard does not guard.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

// -------------------------------------------------------------------- sweep

function sweep() {
  const files = []
  for (const path of chargeSources()) {
    let source
    try {
      source = readFileSync(join(ROOT, path), 'utf8')
    } catch {
      continue
    }
    // Cheap pre-filter on the raw bytes: a file that names none of these
    // cannot violate anything here, and there are thousands of them.
    if (
      !source.includes('transfer_data') &&
      !source.includes('application_fee') &&
      !source.includes('automatic_tax') &&
      !source.includes('on_behalf_of') &&
      !source.includes('Stripe-Account') &&
      !source.includes(REVERSAL_FN)
    ) {
      continue
    }
    files.push({ path, code: stripComments(source) })
  }

  const results = files.map((file) => inspect(file.path, file.code))
  const problems = results.flatMap((result) => result.problems)
  const reversal = reversalWired(files)
  if (reversal) {
    problems.push({
      invariant: 4,
      path: REVERSAL_CALLER,
      line: 1,
      message: reversal,
      evidence: '',
    })
  }

  const chargeSites = results.filter((result) => result.emitsDestination)

  if (asJson) {
    process.stdout.write(
      JSON.stringify({
        scanned: files.length,
        chargeSites: chargeSites.map((site) => site.path),
        problems,
      }),
    )
    process.exit(problems.length === 0 ? 0 : 1)
  }

  console.log(
    `Read ${files.length} Connect-adjacent file(s); ` +
      `${chargeSites.length} emit a destination charge.`,
  )
  for (const site of chargeSites) {
    console.log(
      `  ${site.path === EMITTER ? 'EMITTER    ' : 'hand-rolled'}  ` +
        `${site.path}${site.enablesStripeTax ? '  [Stripe Tax]' : ''}`,
    )
  }

  if (problems.length === 0) {
    console.log('')
    console.log(
      'Every charge settles on Aglyn’s platform account, no Stripe-Tax ' +
        'path uses the fee form, and the subscription reversal is wired — ' +
        'the shape ToS §10.7 describes.',
    )
    process.exit(0)
  }

  for (const problem of problems) {
    console.error('')
    console.error(
      `${problem.path}:${problem.line} — invariant ${problem.invariant}`,
    )
    console.error(`  ${problem.message}`)
    if (problem.evidence) console.error(`  > ${problem.evidence}`)
  }
  console.error('')
  console.error(
    `${problems.length} charge-shape violation(s). AGL-1956 — Aglyn is the ` +
      'marketplace facilitator and ToS §10.7 states what these parameters do.',
  )
  process.exit(1)
}

/**
 * Imported, not run: `inspect` and `stripComments` are exported so a caller
 * can drive them over MUTATED copies of the real sources and watch each
 * invariant fire. In a shared checkout, editing a real file to prove a red is
 * forbidden — so proving it in memory is the only way to know this guard reds
 * on the code it actually protects, and guarding the sweep is what allows it.
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (selfTest) runSelfTest()
  sweep()
}
