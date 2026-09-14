import baseConfig, { boundaryOverridesFor } from '../../../eslint.config.mjs'

export default [
  ...baseConfig,
  // The edges this plugin still has into other packages, from
  // tools/scripts/lib-boundaries-allowlist.json (AGL-2941). Removed when
  // the last of them is worked off.
  ...boundaryOverridesFor(import.meta.url),
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
]
