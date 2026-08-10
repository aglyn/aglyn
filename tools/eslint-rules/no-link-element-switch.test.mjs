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

// Standalone RuleTester harness (run: `npm run test:eslint-rules`).
//
// Like `no-cross-graph-import`, this rule is not purely syntactic: it reads
// the root element a component's own module declares, so every case carries a
// REAL filename and the imports resolve for real. That is the load-bearing
// part — `<Link>` and `<Button>` are the same shape in the AST, and only their
// modules say that one is an `<a>` and the other a `<button>`.
//
// The invalid cases are the three shipped violations, verbatim:
//
//   1. the linked accordion header at `b96e97c16` — introduced ONE DAY after
//      the Link Container fix landed, removed again in `17ae06b32`;
//   2. `screen-link.tsx:85-98`, live at the time of writing (AGL-1347 owns
//      the fix; this rule's job is to report it, not to fix it);
//   3. the same early-return shape in `button.tsx`, found BY this rule.
//
// They stay here as fixtures once the files are fixed: the point of a
// regression case is that it keeps failing after the code stops.

import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import rule from './no-link-element-switch.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const MUI = 'libs/plugins/mui/src/lib/components'
/** Link Container — the component that settled the shape (`f284feeee`). */
const LINK_BOX = join(ROOT, MUI, 'link-box.tsx')
const ACCORDION = join(ROOT, MUI, 'accordion.tsx')
const SCREEN_LINK = join(ROOT, MUI, 'screen-link.tsx')
const BUTTON = join(ROOT, MUI, 'button.tsx')

const PREAMBLE = [
  "import * as Aglyn from '@aglyn/aglyn'",
  "import { AppLink } from '@aglyn/shared-ui-jsx'",
  "import Button from '@mui/material/Button'",
  "import Link from '@mui/material/Link'",
  "import MuiBox from '@mui/material/Box'",
  "import Typography from '@mui/material/Typography'",
].join('\n')

const component = (body) =>
  `${PREAMBLE}\nconst C = (props: any) => {\n${body}\n}\n`

/** Asserting the derivation string is the point: it proves the module was read. */
const HREF = 'its `href`'
const overrides = (host) => `\`component="${host}"\``
const declared = (name, host, specifier) =>
  `\`${name}\` renders \`<${host}>\` — \`${specifier}\` declares it`
const switched = (host, why) => ({
  messageId: 'elementSwitch',
  data: { host, why, anchorWhy: HREF },
})

ruleTester.run('no-link-element-switch', rule, {
  valid: [
    // The settled shape itself, read from the file that settled it. If Link
    // Container ever drifts back to a `<div>`, this case fails.
    {
      filename: LINK_BOX,
      code: readFileSync(LINK_BOX, 'utf8'),
    },
    // The accordion AFTER `17ae06b32`: a bare MUI `<Link>` opposite an
    // `<AppLink>`. Two different components, and it is still correct, because
    // `Link.d.ts` declares `'a'`. Nothing in the file says so — the rule has
    // to go and read it.
    {
      filename: ACCORDION,
      code: component(`
        const { href, suppressNavigation } = Aglyn.useScreenLink(props.screenId)
        return href && !suppressNavigation ? (
          <AppLink href={href}>{props.children}</AppLink>
        ) : (
          <Link underline="none">{props.children}</Link>
        )
      `),
    },
    // Same element, `href` omitted when it does not resolve — the invariant
    // stated in its shortest form.
    {
      filename: SCREEN_LINK,
      code: component(`
        const { href } = Aglyn.useLinkTarget(props.screenId, props.href)
        return href ? <AppLink href={href} /> : <AppLink />
      `),
    },
    // Both branches anchors, by two different routes: an explicit
    // \`component="a"\` and an \`href\`.
    {
      filename: LINK_BOX,
      code: component(`
        const { href } = Aglyn.useLinkTarget(props.screenId, props.href)
        if (!href) return <MuiBox component="a">{props.children}</MuiBox>
        return <AppLink href={href}>{props.children}</AppLink>
      `),
    },
    // A DISCRIMINANT, not a resolution: a link run renders as a link and a
    // text run as text. Same object, different property — and markdown-lite
    // renders exactly this in four places.
    {
      filename: SCREEN_LINK,
      code: component(`
        const inline = props.inline
        return inline.type === 'link' ? (
          <AppLink href={inline.href}>{inline.text}</AppLink>
        ) : (
          <Typography>{inline.text}</Typography>
        )
      `),
    },
    // An ordinary optional link: the href is built by a local helper, so
    // nothing here depends on the screens map. The console has six of these.
    {
      filename: SCREEN_LINK,
      code: component(`
        const hrefFor = (row: any) => (row.id ? '/x/' + row.id : null)
        const href = hrefFor(props.row)
        return href ? (
          <AppLink href={href}>{props.row.name}</AppLink>
        ) : (
          <Typography>{props.row.name}</Typography>
        )
      `),
    },
    // No anchor on either side is not this rule's business.
    {
      filename: SCREEN_LINK,
      code: component(`
        const { href } = Aglyn.useLinkTarget(props.screenId, props.href)
        return href ? <Typography /> : <Button />
      `),
    },
  ],

  invalid: [
    // 1. The linked accordion header at `b96e97c16`, verbatim — the violation
    //    that shipped one day after the fix for the same bug.
    {
      filename: ACCORDION,
      code: component(`
        const { href, suppressNavigation } = Aglyn.useScreenLink(props.screenId)
        return (
          <div>
            {href && !suppressNavigation ? (
              <AppLink href={href} underline="hover">
                {props.children}
              </AppLink>
            ) : (
              <Link component="span" underline="none" color="inherit">
                {props.children}
              </Link>
            )}
          </div>
        )
      `),
      errors: [switched('span', overrides('span'))],
    },
    // 2. `screen-link.tsx:85-98` as it stands today: the divergence twice over
    //    in one early return — `<span>` on the link branch, `<button>` on the
    //    button branch. Only the second needs the module read to be caught.
    {
      filename: SCREEN_LINK,
      code: component(`
        const { href, suppressNavigation } = Aglyn.useLinkTarget(
          props.screenId,
          props.href,
        )
        const asLink = props.renderAs === 'link'
        if (!href || suppressNavigation) {
          return asLink ? (
            <Link component="span" underline="hover" />
          ) : (
            <Button variant={props.variant} />
          )
        }
        return asLink ? (
          <AppLink underline="hover" href={href} />
        ) : (
          <AppLink componentVariant="button" href={href} />
        )
      `),
      errors: [
        switched('span', overrides('span')),
        switched(
          'button',
          declared('Button', 'button', '@mui/material/Button'),
        ),
      ],
    },
    // 3. `button.tsx` — the same early return with no ternary at all. Found by
    //    this rule, not by a human; the plugin's Button element has carried it
    //    since it learned to link.
    {
      filename: BUTTON,
      code: component(`
        const { href, suppressNavigation } = Aglyn.useLinkTarget(
          props.screenId,
          props.href,
        )
        if (!href || suppressNavigation) {
          return <Button />
        }
        return <AppLink componentVariant="button" href={href} />
      `),
      errors: [
        switched(
          'button',
          declared('Button', 'button', '@mui/material/Button'),
        ),
      ],
    },
    // 4. A map lookup rather than a hook, and an `if/else` rather than an
    //    early return — the language switcher's shape.
    {
      filename: SCREEN_LINK,
      code: component(`
        const screens = Aglyn.useScreens()
        const href = screens?.[props.screenId]
        if (!href) {
          return <Button size="small" />
        } else {
          return <AppLink componentVariant="button" href={href} />
        }
      `),
      errors: [
        switched(
          'button',
          declared('Button', 'button', '@mui/material/Button'),
        ),
      ],
    },
    // 5. The switch expressed on the tag itself rather than on the element.
    {
      filename: SCREEN_LINK,
      code: component(`
        const { href } = Aglyn.useLinkTarget(props.screenId, props.href)
        return (
          <MuiBox component={href ? 'a' : 'span'} href={href}>
            {props.children}
          </MuiBox>
        )
      `),
      errors: [
        {
          messageId: 'hostPropSwitch',
          data: { prop: 'component', host: 'span' },
        },
      ],
    },
    // 6. …and on an `as=` prop, which is the same question spelled the other
    //    library's way.
    {
      filename: SCREEN_LINK,
      code: component(`
        const { href } = Aglyn.useLinkTarget(props.screenId, props.href)
        return (
          <MuiBox as={href ? 'a' : 'div'} href={href}>
            {props.children}
          </MuiBox>
        )
      `),
      errors: [
        { messageId: 'hostPropSwitch', data: { prop: 'as', host: 'div' } },
      ],
    },
  ],
})

console.log('no-link-element-switch: all RuleTester cases passed')
