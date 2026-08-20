import { createRequire } from 'node:module'
import globals from 'globals'
import nextPlugin from '@next/eslint-plugin-next'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import nx from '@nx/eslint-plugin'
import importPlugin from 'eslint-plugin-import'
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'
import eslintPluginMobx from 'eslint-plugin-mobx'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import eslintPluginTsdoc from 'eslint-plugin-tsdoc'
import noCrossGraphImport from './tools/lint-rules/no-cross-graph-import.mjs'
import noDynamicFirstPartyImport from './tools/lint-rules/no-dynamic-first-party-import.mjs'
import noLinkElementSwitch from './tools/lint-rules/no-link-element-switch.mjs'
import noListenerRowSpreadIntoWrite from './tools/lint-rules/no-listener-row-spread-into-write.mjs'
import noPlanGatedEntitlement from './tools/lint-rules/no-plan-gated-entitlement.mjs'
import noRemoteImageService from './tools/lint-rules/no-remote-image-service.mjs'
import noSxAfterSpread from './tools/lint-rules/no-sx-after-spread.mjs'
import noUnguardedLoadingHook from './tools/lint-rules/no-unguarded-loading-hook.mjs'

/**
 * The React version, stated rather than detected (AGL-2479).
 *
 * `eslint-plugin-react@7.37.5` is the LAST published release and its peer
 * range tops out at `eslint ^9.7`; there is no version of it that supports
 * ESLint 10, which f6a39902e moved us to. Its version DETECTION path —
 * `getReactVersionFromContext` → `detectReactVersion` → `resolveBasedir` —
 * calls `context.getFilename()`, one of the deprecated rule-context methods
 * ESLint 10 REMOVED. So every react rule that asks what version we are on
 * throws at rule-load time, and the whole lint run dies with
 * `Error while loading rule 'react/no-direct-mutation-state'`.
 *
 * Detection exists only to answer this question. Answering it directly skips
 * the removed API entirely — and is what eslint-plugin-react's own docs
 * recommend over `'detect'` regardless, since detection re-resolves `react`
 * from disk. Read from the installed package so it cannot go stale against
 * `package.json`.
 *
 * Only the five projects that spread `nx.configs['flat/react']` were red —
 * that preset carries no `settings.react` of its own, while the root's
 * `flat/react-typescript` blocks are scoped to `.ts`/`.tsx` and so never
 * matched the `eslint.config.mjs` files the crash was reported on. This
 * setting is unscoped on purpose: it must reach every config that turns a
 * react rule on, whichever preset put it there.
 */
const reactVersion = createRequire(import.meta.url)('react/package.json').version

// Local rules that guard Aglyn-specific invariants (not published as a plugin).
const aglynPlugin = {
  rules: {
    'no-cross-graph-import': noCrossGraphImport,
    'no-dynamic-first-party-import': noDynamicFirstPartyImport,
    'no-link-element-switch': noLinkElementSwitch,
    'no-listener-row-spread-into-write': noListenerRowSpreadIntoWrite,
    'no-plan-gated-entitlement': noPlanGatedEntitlement,
    'no-remote-image-service': noRemoteImageService,
    'no-sx-after-spread': noSxAfterSpread,
    'no-unguarded-loading-hook': noUnguardedLoadingHook,
  },
}

// Mirrors the legacy eslintrc "overrides" semantics: each nx preset only
// applies to the extension block that extended it, so a later block cannot
// stomp an earlier block's rule severities.
const scopeTo = (configs, files) => configs.map((config) => ({ ...config, files }))

const tsRuleOverrides = {
  '@typescript-eslint/ban-ts-comment': 'off',
  '@typescript-eslint/no-empty-function': 'off',
  '@typescript-eslint/no-empty-interface': 'off',
  '@typescript-eslint/no-empty-object-type': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-namespace': 'warn',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/no-unused-vars': 'warn',
  '@typescript-eslint/no-unused-expressions': [
    'error',
    { allowShortCircuit: true, allowTernary: true },
  ],
  '@typescript-eslint/no-var-requires': 'off',
  'no-fallthrough': 'off',
  'no-restricted-imports': [
    'error',
    {
      patterns: ['@mui/*/*/*', '!@mui/material/test-utils/*'],
    },
  ],
  'react/no-children-prop': 'off',
  'react-hooks/rules-of-hooks': 'warn',
  'react-hooks/exhaustive-deps': 'warn',
}

const jsRuleOverrides = {
  'no-fallthrough': 'off',
  'no-unused-expressions': [
    'error',
    { allowShortCircuit: true, allowTernary: true },
  ],
  'no-restricted-imports': [
    'error',
    {
      patterns: ['@mui/*/*/*', '!@mui/material/test-utils/*'],
    },
  ],
  'react/no-children-prop': 'off',
  'react-hooks/rules-of-hooks': 'warn',
  'react-hooks/exhaustive-deps': 'warn',
}

export default [
  ...nx.configs['flat/base'],
  {
    plugins: {
      '@typescript-eslint': tsPlugin,
      tsdoc: eslintPluginTsdoc,
      mobx: eslintPluginMobx,
      '@next/next': nextPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
      import: importPlugin,
      aglyn: aglynPlugin,
    },
    // See `reactVersion` above: unscoped so it reaches every react rule.
    settings: { react: { version: reactVersion } },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // A plan-less org resolves as `free`; never gate a paid feature on the
      // presence of the `plan` field (AGL-46x free-tier leak regression guard).
      'aglyn/no-plan-gated-entitlement': 'error',
      // A hook that reports a value plus a readiness flag means both or
      // neither — taking the value alone is AGL-1047/1061/1064, three times
      // the same defect.
      'aglyn/no-unguarded-loading-hook': 'error',
      // App Router's two module graphs. An import that crosses them
      // typechecks clean and passes every unit test, so it surfaces only at
      // `nx build` — i.e. at promotion time (AGL-1349, which took main down).
      'aglyn/no-cross-graph-import': 'error',
      // A deferred `@aglyn/*` import in a SPEC registers a dynamic nx graph
      // edge, which makes `@nx/enforce-module-boundaries` forbid every static
      // import of that library in every project that reaches it. Four times
      // now the blast has landed in a different project on files that did not
      // change, under a message whose file list is EMPTY: AGL-949 (100
      // errors), AGL-1329 (14), email-media-src-drift (~20), and
      // AGL-2282/AGL-2313 — 441 errors across 364 console files, promotion
      // blocked. Which positions nx counts as dynamic is an internal heuristic
      // no reviewer can see in a diff, so the rule refuses the whole shape.
      'aglyn/no-dynamic-first-party-import': 'error',
      // An element type chosen from the screens map is a hydration mismatch:
      // the map behind the ISR render is not the map behind the render that
      // hydrates it (AGL-1268). Three components shipped this, one of them a
      // DAY after the fix, and the invariant lived only in a comment in
      // `link-box.tsx` where nobody editing another file would read it.
      //
      // WARN, deliberately and temporarily: it reports four live instances
      // across three files — `screen-link.tsx:89`/`:91`, `button.tsx:101`,
      // `language-switcher.tsx:105` — and three of them are the same
      // `<button>`-vs-anchor question AGL-1347 is open to answer. Error would
      // block everyone on a design decision that is not theirs. Flip to
      // `'error'` with AGL-1347's fix; the rule is clean everywhere else.
      'aglyn/no-link-element-switch': 'warn',
      // `idField: '$id'` stamps the document id onto the in-memory row and
      // nothing persists it. Spreading such a row into a write payload stores
      // it as a real field — silently, since nothing reads it, and
      // permanently. Three issues have now come out of this one affordance
      // (AGL-1358 overwrites whole documents, AGL-1372 omits fields, AGL-1374
      // invents one), which is the AGL-1357 threshold.
      //
      // ERROR from the start, unlike no-link-element-switch: the pre-fix tree
      // at `86270af4a^` gives it exactly the four instances AGL-1374 listed
      // and nothing else across 14,742 files, and today's tree is clean. It
      // has no backlog to work off.
      'aglyn/no-listener-row-spread-into-write': 'error',
      // A third-party service asked to DRAW our data receives it in a GET
      // query string. The POS card QR did this with a LIVE Stripe payment
      // link — a URL that pays the order for whoever holds it — on every
      // transaction, to a vendor with no DPA and no register entry
      // (AGL-1671). ERROR from the start: today's tree is clean, and the
      // one instance it exists for is the one this rule was written from.
      'aglyn/no-remote-image-service': 'error',
      'mobx/exhaustive-make-observable': 'off',
      'mobx/unconditional-make-observable': 'off',
      'mobx/missing-make-observable': 'off',
      'mobx/missing-observer': 'off',
      'node/no-extraneous-import': 'off',
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: [],
          enforceBuildableLibDependency: true,
          // @aglyn/plugins-*: the generated loader manifests (AGL-417)
          // import plugins dynamically while the remaining static imports
          // await extraction (AGL-418/419) — and plugin-internal console
          // pages lazy() their own components. Exempt the consistency check;
          // the scope:app boundary rule lands with the Phase-4 close-out.
          checkDynamicDependenciesExceptions: [
            '@aglyn/besigner-ui',
            '@aglyn/plugins-*',
          ],
          depConstraints: [
            {
              // Apps never import feature plugins statically (AGL-417/419):
              // plugins reach the apps ONLY through the generated loader
              // manifests (plugins.*.generated.ts, file-scoped disable) and
              // the core plugin-manager registries (widgets, providers,
              // site runtimes, page hooks, API dispatch). Plugin→plugin
              // stays legal via the aglyn:addons source rule below.
              sourceTag: 'scope:app',
              notDependOnLibsWithTags: ['aglyn:addons'],
            },
            {
              sourceTag: 'scope:lib',
              onlyDependOnLibsWithTags: ['scope:lib'],
            },
            {
              sourceTag: 'scope:data',
              onlyDependOnLibsWithTags: ['scope:data', 'scope:util'],
            },
            {
              sourceTag: 'scope:feature',
              onlyDependOnLibsWithTags: [
                'scope:data',
                'scope:feature',
                'scope:ui',
                'scope:util',
              ],
            },
            {
              sourceTag: 'scope:ui',
              onlyDependOnLibsWithTags: [
                'scope:data',
                'scope:ui',
                'scope:util',
              ],
            },
            {
              sourceTag: 'scope:util',
              onlyDependOnLibsWithTags: ['scope:util', 'scope:data'],
            },
            {
              // Feature plugins (AGL-409). They carry ONLY `aglyn:addons`
              // (not the generic `scope:lib`/`scope:aglyn`), so as a
              // dependency TARGET no core scope's allowlist reaches them —
              // core libs cannot import a plugin, keeping the app runnable
              // with any plugin absent. As a SOURCE they may still import
              // any lib (every lib is `scope:lib`) and each other.
              sourceTag: 'aglyn:addons',
              onlyDependOnLibsWithTags: [
                'aglyn:addons',
                'aglyn:framework',
                'aglyn:renderer',
                'scope:aglyn',
                'scope:shared',
                'scope:ui',
                'scope:util',
                'scope:data',
                'scope:feature',
                'scope:lib',
              ],
            },
            {
              sourceTag: 'scope:aglyn',
              onlyDependOnLibsWithTags: ['scope:aglyn', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'aglyn:framework',
              onlyDependOnLibsWithTags: ['aglyn:framework', 'scope:shared'],
            },
            {
              sourceTag: 'aglyn:renderer',
              onlyDependOnLibsWithTags: ['aglyn:framework', 'scope:shared'],
            },
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  ...scopeTo(nx.configs['flat/typescript'], ['**/*.ts']),
  {
    files: ['**/*.ts'],
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...tsRuleOverrides,
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'tsdoc/syntax': 'warn',
    },
  },
  ...scopeTo(
    [...nx.configs['flat/typescript'], ...nx.configs['flat/react-typescript']],
    ['**/*.tsx'],
  ),
  {
    files: ['**/*.tsx'],
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...tsRuleOverrides,
    },
  },
  ...scopeTo(nx.configs['flat/javascript'], ['**/*.js']),
  {
    files: ['**/*.js'],
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsRuleOverrides,
    },
  },
  ...scopeTo(nx.configs['flat/javascript'], ['**/*.jsx']),
  {
    files: ['**/*.jsx'],
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsRuleOverrides,
    },
  },
  // `.mjs` was matched by NO block above — every `files` list stops at
  // js/jsx/ts/tsx, so eslint resolved ZERO rules for the 190+ tracked .mjs
  // files and exited 0 having evaluated nothing (AGL-1815). That set includes
  // tools/scripts/** — the drift checkers, the deploy tooling, the erase-org
  // CLI — i.e. the guards everything else trusts, with the most direct
  // production reach in the repo. A planted `debugger;` passed "eslint clean".
  ...scopeTo(nx.configs['flat/javascript'], ['**/*.mjs']),
  {
    files: ['**/*.mjs'],
    languageOptions: {
      // Node scripts, not browser code — and unlike the ts/js blocks these
      // files are never type-checked, so `no-undef` below is the only thing
      // standing between a typo'd identifier and a runtime crash mid-deploy.
      globals: { ...globals.node },
    },
    rules: {
      // Re-enabled: typescript-eslint's eslint-recommended turns it off on
      // the assumption the compiler catches undefineds; nothing compiles
      // these files.
      'no-undef': 'error',
      // These are Node scripts: the react/browser overrides in
      // jsRuleOverrides do not apply, and the base set alone leaves the
      // rules AGL-1815 named. no-unused-vars/no-undef/no-debugger arrive
      // with the recommended set above; the rest are explicit:
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-debugger': 'error',
      'require-atomic-updates': 'error',
      'no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      // Parity with tsRuleOverrides: intentional no-op callbacks
      // (`.catch(() => {})`, test-double stubs) are idiomatic here.
      '@typescript-eslint/no-empty-function': 'off',
      // warn severity matches tsRuleOverrides; ignoreRestSiblings admits the
      // `const { omitted, ...rest } = row` idiom the scripts use to strip a
      // field before serializing.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Plugin components render canvas nodes, so their props bag carries the
    // author's `sx`. Writing an `sx` literal after spreading it discards
    // styles that were authored, saved and are sitting in the document —
    // five shipped instances before anything in the toolchain noticed
    // (AGL-1240/1284). Scoped here because this is where node props are
    // spread; widen it the first time the shape appears outside.
    files: ['libs/plugins/**/*.tsx'],
    rules: { 'aglyn/no-sx-after-spread': 'error' },
  },
  {
    // Base UI (AGL-1222) is a pre-1.x-shaped dependency whose parts compose
    // by hand; it earns its keep for the besigner menubar and nothing else so
    // far. Keeping every import in one module means a breaking upgrade is a
    // one-file change instead of a search-and-replace across the console.
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    ignores: ['**/components/layouts/app-bar-menubar.component.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // Repeated from the shared overrides: a later `rules` entry
            // replaces the whole option object rather than merging into it.
            { group: ['@mui/*/*/*', '!@mui/material/test-utils/*'] },
            {
              group: ['@base-ui/react', '@base-ui/react/*'],
              message:
                'Base UI stays inside apps/console/components/layouts/app-bar-menubar.component.tsx (AGL-1222) so a breaking upgrade is one file.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      '.github',
      '/workspace.json',
      '**/next-env.d.ts',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.docusaurus/**',
    ],
  },
]
