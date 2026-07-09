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
      ].join('|') +
      ')/)',
  ],
  setupFiles: [require.resolve('./jest.setup.js')],
  // Static asset imports (e.g. `import img from './foo.png'`) are normally
  // transformed by Next.js's webpack loader into a StaticImageData object.
  // Jest has no such loader, so map them to a stub with the same shape.
  moduleNameMapper: {
    '\\.(png|jpe?g|gif|svg|webp|avif|ico|bmp)$': require.resolve('./jest.file-mock.js'),
  },
}
