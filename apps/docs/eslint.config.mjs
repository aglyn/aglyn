import baseConfig from '../../eslint.config.mjs'

/**
 * `apps/docs` was the one project in the workspace with no ESLint config at
 * all, and therefore no `lint` target — invisible to `nx affected -t lint`
 * however the graph moved (AGL-2377).
 *
 * It lints with the ROOT toolchain, not its own. This app is deliberately
 * standalone in every other respect — its own `node_modules`, React 18, and
 * TypeScript 5.6.3 pinned by `@docusaurus/tsconfig` against the root's 6.0.2 —
 * but it declares no `eslint` dependency, so `@nx/eslint:lint` resolves eslint
 * and every plugin from the root. That is the cheap direction: no second
 * eslint install to keep in step, and the same rule set the other 49 projects
 * answer to. It also means the version skew that made `docs:typecheck`
 * silently red for four weeks (AGL-2363) cannot recur here — ESLint parses
 * with `@typescript-eslint/parser` from the root and never reads
 * `apps/docs/tsconfig.json`.
 *
 * What it actually covers is small and worth stating plainly: the ~7
 * `.ts`/`.tsx` files (`docusaurus.config.ts`, the four `sidebars*.ts`,
 * `src/error-beacon.ts`, `src/pages/status.tsx`). The 123 `.md` files under
 * `docs/` are outside anything ESLint in this repo understands — markdown is
 * covered by `check:docs-self-host` and `generate:docs-help:check`, not here.
 */
export default [
  ...baseConfig,
  {
    // Docusaurus build output and its generated cache. Neither is tracked, and
    // `build/**` is NOT in the root config's ignore list (only `.next`, `dist`,
    // `coverage` and `.docusaurus` are), so without this a stale local build
    // directory is linted as source — which is exactly how the sibling
    // `cloud/functions` config's `lib/**` ignore failed to bite. Written with
    // a leading `**/` on purpose: flat-config relative patterns resolve
    // against a base path that depends on how ESLint was invoked, and these
    // must hold whether the run starts here or at the workspace root.
    ignores: ['**/build/**', '**/.docusaurus/**', '**/node_modules/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {},
  },
]
