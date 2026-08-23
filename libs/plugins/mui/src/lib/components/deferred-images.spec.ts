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

// Statically, never `require`d inside the test (AGL-949/AGL-1329/AGL-2282):
// a deferred `@aglyn/aglyn` here registers a DYNAMIC nx graph edge on
// plugins-mui, and `@nx/enforce-module-boundaries` then forbids every static
// import of that library in every project that reaches it. The first run of
// this file did exactly that and reddened seventeen unrelated files across
// four projects with an empty "lazy-loaded in these files" list.
import { DEFERRED_IMAGE_ATTRIBUTES } from '@aglyn/aglyn'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'

/**
 * Every `<img>` a published page renders carries a loading decision (AGL-2486).
 *
 * ## Why this is a SOURCE assertion and not a render test
 *
 * The defect is not what one component renders — it is which components were
 * left OUT of the ranking scheme. A render test can only fail for a component
 * somebody remembered to write a render test for, and the seven images this
 * found were missed for exactly that reason: `image.tsx` had a full behavioural
 * spec covering its own `loading`/`fetchpriority` decisions while a product
 * grid four sections below it fetched eagerly at default priority and no test
 * anywhere had an opinion. Same shape as `stripe-stays-lazy.spec.ts`: the thing
 * being guarded is a property of the SET, so the guard has to read the set.
 *
 * ## Why the TypeScript parser and not a regex
 *
 * A regex over these files cannot tell `component="img"` inside a JSX element
 * from the same characters inside one of the long comments above it — and
 * several of these files discuss `<img src=…>` in prose, because they are the
 * files that sanitise author-supplied image sources. It also cannot find the
 * end of an element whose `sx` prop contains nested braces. So this walks the
 * real syntax tree and reads real attributes.
 *
 * ## The rule
 *
 * Every JSX element that renders an `<img>` — a literal `<img>`, or MUI's
 * `component="img"` escape on `Box`/`CardMedia` — must either
 *
 *  - spread `DEFERRED_IMAGE_ATTRIBUTES`, or
 *  - be listed in {@link EAGER_BY_DESIGN} below, which is the LCP-candidate
 *    exemption and is deliberately short.
 *
 * `lazy` on its own does NOT satisfy it, and that is the point rather than
 * pedantry: a `lazy` image at default priority still outranks a `lazy` image
 * at `low`, so a partial hint re-creates a smaller version of the inversion.
 * Two sites in `collection.tsx` were exactly that.
 */

/** Repo root, from this file's location. */
const ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')

/**
 * The files that render an `<img>` onto a PUBLISHED TENANT PAGE.
 *
 * Scoped to the tenant render path on purpose. Console and besigner surfaces
 * render images too, but they are authenticated tools behind a sign-in where
 * an eager thumbnail costs an operator nothing and the page is not being
 * measured by Lighthouse on a phone. Widening this list to them would produce
 * a lot of noise about images that are not the subject.
 *
 * Kept explicit rather than globbed so that ADDING a tenant-rendered image
 * file is a deliberate act that shows up in a diff. A glob would silently
 * cover new files, which sounds better until it silently stops covering a
 * file somebody moved.
 */
const TENANT_IMAGE_SOURCES = [
  'libs/plugins/mui/src/lib/components/image.tsx',
  'libs/plugins/mui/src/lib/components/collection.tsx',
  'libs/plugins/mui/src/lib/components/markdown.tsx',
  'libs/plugins/mui/src/lib/components/product.tsx',
  'libs/plugins/commerce/src/lib/components/product-grid.tsx',
  'libs/plugins/commerce/src/lib/components/related-products.tsx',
  'libs/plugins/commerce/src/lib/components/wishlist.tsx',
  'libs/plugins/commerce/src/lib/components/cart.tsx',
  'libs/plugins/commerce/src/lib/components/product-detail.tsx',
  'libs/plugins/events-calendar/src/lib/components/event-list.tsx',
]

/**
 * The images allowed to load eagerly, because each is its page's LCP
 * candidate and deferring it re-introduces the bug AGL-2486 opened with.
 *
 * Recorded as `file:line`-independent descriptions — a line number would
 * rot on the first edit above it — matched by the `src`/`image` expression
 * the element is given, which is what actually identifies it.
 */
const EAGER_BY_DESIGN: ReadonlyArray<{ file: string; srcExpression: string }> =
  [
    {
      // `image.tsx` decides per-node: the lead image in document order is
      // `eager`, everything else spreads the deferred set. The element
      // therefore carries a CONDITIONAL spread, handled below.
      file: 'libs/plugins/mui/src/lib/components/image.tsx',
      srcExpression: 'src',
    },
    {
      // The gallery hero at the top of a product page.
      file: 'libs/plugins/commerce/src/lib/components/product-detail.tsx',
      srcExpression: 'galleryImage',
    },
  ]

interface ImageElement {
  file: string
  line: number
  srcExpression: string
  spreadsDeferredSet: boolean
  hasConditionalDeferredSpread: boolean
  literalLoading: string | undefined
}

/** `(x ? a : b)` and `x ? a : b` are the same decision; only one is a node. */
function unwrapParentheses(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

/** Every `<img>`-rendering JSX element in one file, with what it declares. */
function imageElementsIn(file: string): ImageElement[] {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  )
  const found: ImageElement[] = []

  const attributesOf = (
    node: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  ) => node.attributes.properties

  const rendersAnImg = (
    node: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  ) => {
    if (node.tagName.getText(source) === 'img') return true
    return attributesOf(node).some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(source) === 'component' &&
        // `component="img"` and `component={'img'}` are the same element.
        /^["'{]?['"]?img['"]?[}]?$/.test(
          attribute.initializer?.getText(source) ?? '',
        ),
    )
  }

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (rendersAnImg(node)) {
        const properties = attributesOf(node)
        // A spread whose expression mentions the shared set. Both the bare
        // spread and the eager/deferred ternary in `image.tsx` match here;
        // they are told apart by whether the expression is a ternary.
        const deferredSpreads = properties.filter(
          (property) =>
            ts.isJsxSpreadAttribute(property) &&
            property.expression
              .getText(source)
              .includes('DEFERRED_IMAGE_ATTRIBUTES'),
        )
        // `{...(eager ? … : DEFERRED_IMAGE_ATTRIBUTES)}` parses as a spread of
        // a PARENTHESIZED expression, so asking `isConditionalExpression` of
        // it directly answers false and `image.tsx` reads as an unconditional
        // defer. Found by the exemption mutation below going red at rest.
        const conditional = deferredSpreads.some(
          (property) =>
            ts.isJsxSpreadAttribute(property) &&
            ts.isConditionalExpression(unwrapParentheses(property.expression)),
        )
        const loading = properties.find(
          (property) =>
            ts.isJsxAttribute(property) &&
            property.name.getText(source) === 'loading',
        )
        const srcAttribute = properties.find(
          (property) =>
            ts.isJsxAttribute(property) &&
            ['src', 'image'].includes(property.name.getText(source)),
        )
        found.push({
          file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          srcExpression: (srcAttribute as ts.JsxAttribute | undefined)
            ?.initializer?.getText(source)
            .replace(/^\{|\}$/g, '')
            .trim() ?? '<none>',
          spreadsDeferredSet: deferredSpreads.length > 0 && !conditional,
          hasConditionalDeferredSpread: conditional,
          literalLoading: loading
            ? ((loading as ts.JsxAttribute).initializer
                ?.getText(source)
                .replace(/"/g, '') ?? '')
            : undefined,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const ALL_IMAGES = TENANT_IMAGE_SOURCES.flatMap(imageElementsIn)

const describeElement = (element: ImageElement) =>
  `${element.file}:${element.line} (src=${element.srcExpression})`

const isExempt = (element: ImageElement) =>
  EAGER_BY_DESIGN.some(
    (exemption) =>
      exemption.file === element.file &&
      exemption.srcExpression === element.srcExpression,
  )

describe('every tenant-rendered image declares its loading rank (AGL-2486)', () => {
  it('finds the image elements at all', () => {
    // The guard above is a sweep, and a sweep that finds nothing passes. This
    // is the negative control for the parser itself: if `rendersAnImg` ever
    // stops recognising `component="img"` — a MUI rename, a codemod, a
    // ScriptKind mistake — every assertion below goes vacuously green and this
    // is the only thing that notices.
    expect(ALL_IMAGES.length).toBeGreaterThanOrEqual(11)
    expect(
      TENANT_IMAGE_SOURCES.filter(
        (file) => !ALL_IMAGES.some((element) => element.file === file),
      ),
    ).toEqual([])
  })

  it('defers every image that is not an LCP candidate', () => {
    const offenders = ALL_IMAGES.filter(
      (element) =>
        !element.spreadsDeferredSet &&
        !element.hasConditionalDeferredSpread &&
        !isExempt(element),
    ).map(describeElement)
    // Named individually rather than counted: when this goes red the message
    // has to say WHICH image, because the fix is per-element.
    expect(offenders).toEqual([])
  })

  it('never accepts a bare `loading` as the whole hint', () => {
    // `lazy` alone is the partial-hint failure: it outranks a `lazy` + `low`
    // image, so it inverts the order it was meant to fix. An element may
    // carry a literal `loading` ONLY if it is an exempt LCP candidate.
    const partial = ALL_IMAGES.filter(
      (element) => element.literalLoading !== undefined && !isExempt(element),
    ).map((element) => `${describeElement(element)} loading=${element.literalLoading}`)
    expect(partial).toEqual([])
  })

  it('does not let the exemption list be used to DEFER an LCP image', () => {
    // The hole this closes was found by mutation, not by reading: the first
    // version of this file only PERMITTED an exempt image to stay eager, so
    // spreading the deferred set over the product-detail hero — the exact
    // "finish the job" edit the comment there warns about — passed all six
    // assertions. An exemption has to constrain both directions or it is
    // just a list of names.
    //
    // `image.tsx` is exempt with a CONDITIONAL spread (eager only for the
    // lead image), which is the one shape that is allowed to do both.
    const deferredExemptions = ALL_IMAGES.filter(
      (element) => isExempt(element) && element.spreadsDeferredSet,
    ).map(describeElement)
    expect(deferredExemptions).toEqual([])
  })

  it('keeps the eager exemption list short and real', () => {
    // Every exemption must correspond to an image that EXISTS. An exemption
    // for an element somebody deleted is a licence nobody is using, and the
    // next person to add an image to that file inherits it silently.
    const unmatched = EAGER_BY_DESIGN.filter(
      (exemption) =>
        !ALL_IMAGES.some(
          (element) =>
            element.file === exemption.file &&
            element.srcExpression === exemption.srcExpression,
        ),
    ).map((exemption) => `${exemption.file} (src=${exemption.srcExpression})`)
    expect(unmatched).toEqual([])
    expect(EAGER_BY_DESIGN).toHaveLength(2)
  })

  it('spreads the one shared set rather than three literals', () => {
    // The set only works if it is the same set everywhere. This pins that the
    // constant is the single definition — a file that re-declared its own
    // `{ loading: 'lazy', fetchPriority: 'low', decoding: 'async' }` would
    // satisfy the rule above while drifting the next time one member changes.
    const deferred = ALL_IMAGES.filter((element) => !isExempt(element))
    expect(deferred.length).toBeGreaterThanOrEqual(9)
    expect(
      deferred.filter((element) => !element.spreadsDeferredSet).map(describeElement),
    ).toEqual([])
  })
})

describe('the deferred set itself (AGL-2486)', () => {
  it('is the three attributes, and all three', () => {
    // Imported from source rather than re-typed: a test that restates the
    // value it is checking cannot fail when the value changes.
    expect(DEFERRED_IMAGE_ATTRIBUTES).toEqual({
      loading: 'lazy',
      fetchPriority: 'low',
      decoding: 'async',
    })
    // Frozen because it is spread into JSX in ten places; a mutation would
    // travel to all of them and to none of their tests.
    expect(Object.isFrozen(DEFERRED_IMAGE_ATTRIBUTES)).toBe(true)
  })
})
