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

// Standalone RuleTester harness (run: `node tools/lint-rules/*.test.mjs`).
// Wired into CI via the `test:eslint-rules` npm script.
//
// The invalid cases are the negative control the rule exists for: each one is
// a real shape that shipped, and each fails the moment the composition order
// is right again.

import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import rule from './no-sx-after-spread.mjs'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const err = [{ messageId: 'sxAfterSpread' }]

ruleTester.run('no-sx-after-spread', rule, {
  valid: [
    // The fix: the node's value LAST, so the author wins.
    '<Box {...rest} sx={[{ p: 2 }, ...nodeSx]} />',
    // The Tabs form (AGL-1284), inline rather than via a local.
    '<Box {...rest} sx={[{ display: "flex" }, ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx])]} />',
    // The Tab panel form: a hide rule legitimately goes after the author's
    // value, because an authored `display` must not reveal a hidden panel.
    '<Box {...rest} sx={[{ p: 2 }, ...nodeSx, ...(visible ? [] : [{ display: "none" }])]} />',
    // The Collection form: an object spread that really is the node's value.
    '<Box {...rest} sx={{ alignItems: "center", ...(rest.sx as object) }} />',
    // Forwarding the value untouched, and anything the rule cannot see into.
    '<Box {...rest} sx={sx} />',
    '<Box {...rest} sx={buildSx(theme)} />',
    '<Box {...rest} sx={[BASE_SX, sx]} />',
    // `sx` BEFORE the spread is the author winning outright — not this bug.
    '<Box sx={{ p: 2 }} {...rest} />',
    // No spread at all: an inner element the author never styles.
    '<Box sx={{ p: 2 }} />',
    // Spreading a literal is not a props bag.
    '<Box {...{ id: "x" }} sx={{ p: 2 }} />',
  ],
  invalid: [
    // The Image shape (AGL-1240) — the one that discarded the hero mockups'
    // radius and drop shadow on every published page.
    {
      code: '<Box {...rest} sx={{ display: "block", borderRadius: 2 }} />',
      errors: err,
    },
    // The Tabs container shape (AGL-1284).
    {
      code: '<Box ref={ref} {...rest} sx={{ display: vertical ? "flex" : undefined }} />',
      errors: err,
    },
    // The Plugin Frame shape: a spread that LOOKS like a merge and folds in
    // nothing but a local conditional.
    {
      code: '<Box {...rest} sx={{ width: "100%", ...(loading ? { visibility: "hidden" } : {}) }} />',
      errors: err,
    },
    // The array form replaces just as thoroughly as the object form.
    {
      code: '<Box {...rest} sx={[{ p: 2 }, { m: 1 }]} />',
      errors: err,
    },
    // Either branch of a conditional is enough to lose the author's value.
    {
      code: '<Box {...rest} sx={loading ? { opacity: 0.5 } : sx} />',
      errors: err,
    },
    // A spread of a member read still carries `sx`.
    {
      code: '<Box {...props.slotProps} sx={{ p: 2 }} />',
      errors: err,
    },
    // Two spreads, one violation — the last spread before `sx` is named.
    {
      code: '<Box {...a} {...rest} sx={{ p: 2 }} />',
      errors: err,
    },
  ],
})

console.log('no-sx-after-spread: all RuleTester cases passed')
