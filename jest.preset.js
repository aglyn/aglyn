const nxPreset = require('@nx/jest/preset').default

module.exports = {
  ...nxPreset,
  /* TODO: Update to latest Jest snapshotFormat
   * By default Nx has kept the older style of Jest Snapshot formats
   * to prevent breaking of any existing tests with snapshots.
   * It's recommend you update to the latest format.
   * You can do this by removing snapshotFormat property
   * and running tests with --update-snapshot flag.
   * Example: "nx affected --targets=test --update-snapshot"
   * More info: https://jestjs.io/docs/upgrading-to-jest29#snapshot-format
   */
  snapshotFormat: { escapeString: true, printBasicPrototype: true },
  // ESM-only packages (react-markdown/unified/remark/rehype ecosystem, plus
  // other ESM-only libs) that jest must transform to CommonJS to require().
  transformIgnorePatterns: [
    '/node_modules/(?!(' +
      [
        'lodash-es', 'flat', 'nanoid', 'react-color', 'react-markdown',
        '@ungap/structured-clone', 'bail', 'ccount', 'character-entities.*',
        'character-reference-invalid', 'comma-separated-tokens',
        'decode-named-character-reference', 'devlop',
        'estree-util-is-identifier-name', 'hast-util-.*', 'html-url-attributes',
        'is-alphabetical', 'is-alphanumerical', 'is-decimal', 'is-hexadecimal',
        'is-plain-obj', 'longest-streak', 'mdast-util-.*',
        'micromark.*', 'parse-entities', 'property-information',
        'remark-.*', 'space-separated-tokens', 'stringify-entities',
        'trim-lines', 'trough', 'unified', 'unist-util-.*', 'vfile.*', 'zwitch',
        '@react-dnd/.*', 'dnd-core', 'react-dnd', 'react-dnd-html5-backend',
        // firebase-admin's app-check module pulls in jwks-rsa -> jose, which
        // ships ESM-only (no CJS build) as of jose v6 (firebase-admin v14).
        'jose',
        // ESM-only as of change-case v5, cookie v2, deepmerge-ts v7,
        // nanoid-dictionary v5.
        'change-case', 'cookie', 'deepmerge-ts', 'nanoid-dictionary',
      ].join('|') +
      ')/)',
  ],
  setupFiles: [require.resolve('./jest.setup.js')],
  // Runs after the test framework is installed (AGL-2382). See the file for
  // why RTL's own 1,000 ms `waitFor` budget is the half `testTimeout` below
  // cannot cover.
  setupFilesAfterEnv: [require.resolve('./jest.setup-after-env.js')],
  // WHY 30 s AND NOT JEST'S 5 s DEFAULT (AGL-2382).
  //
  // `nx affected -t lint test build --parallel=3` runs three tasks at once on
  // a 4-vCPU `ubuntu-latest` runner, and each jest task then takes jest's own
  // default of `cores - 1` workers — up to nine jest workers, plus whichever
  // Next build is running alongside them, on four vCPUs. A heavy RTL spec
  // that costs 0.5-4 s of CPU on an idle developer box therefore takes 5-10x
  // that in WALL CLOCK there, and jest measures wall clock. Nine CI runs in
  // twenty failed this way, always on the slowest test in a file and never on
  // the same one twice: `element-styles-form-flexbox` (518 ms locally) blew
  // 5,000 ms on the runner; `contacts-head-count`'s two failures are its two
  // slowest tests at 3.6 s and 4.1 s locally, already inside 20% of the
  // default before any contention at all.
  //
  // The timeout exists to catch HANGS, not to race the scheduler. 30 s still
  // fails a genuine hang and assertion failures are unaffected — which is
  // exactly the reasoning `apps/console/jest.config.ts` recorded for AGL-1257
  // and has run under since. This lifts that from the one project that
  // happened to hit it first to the preset every project inherits, so the
  // next heavy spec does not have to fail in CI to earn it.
  //
  // NOT the fix for a spec that reaches the network: nothing here does. Every
  // `DEADLINE_EXCEEDED` in those CI logs is a `new Error('DEADLINE_EXCEEDED')`
  // constructed inside a spec to stage a Firestore deadline (six call sites,
  // all under `libs/plugins/*/src/lib/server/*.spec.ts`), and all of those
  // suites PASSED.
  testTimeout: 30_000,
  // Static asset imports (e.g. `import img from './foo.png'`) are normally
  // transformed by Next.js's webpack loader into a StaticImageData object.
  // Jest has no such loader, so map them to a stub with the same shape.
  moduleNameMapper: {
    '\\.(png|jpe?g|gif|svg|webp|avif|ico|bmp)$': require.resolve('./jest.file-mock.js'),
  },
}
