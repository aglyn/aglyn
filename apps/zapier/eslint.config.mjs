import globals from 'globals'
import baseConfig from '../../eslint.config.mjs'

// Aglyn on Zapier (AGL-3643) is plain CommonJS that Node runs as written on
// Zapier's platform: nothing type-checks it, so an undefined name is an error
// here rather than a crash in a merchant's Zap.
export default [
  ...baseConfig,
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'no-undef': 'error',
    },
  },
]
