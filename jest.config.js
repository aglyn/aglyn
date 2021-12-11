const { getJestProjects } = require('@nrwl/jest')

module.exports = {
  projects: [
    ...getJestProjects(),
    '<rootDir>/libs/addons/ui/mui-bundle',
    '<rootDir>/libs/core/data/framework',
    '<rootDir>/libs/core/feature/besigner',
    '<rootDir>/libs/core/feature/renderer',
    '<rootDir>/libs/shared/data/brand',
    '<rootDir>/libs/shared/data/mid',
    '<rootDir>/libs/shared/data/types',
    '<rootDir>/libs/shared/feature/themes',
    '<rootDir>/libs/shared/ui/jsx',
    '<rootDir>/libs/shared/util/dom',
    '<rootDir>/libs/shared/util/emitter',
    '<rootDir>/libs/shared/util/errors',
    '<rootDir>/libs/shared/util/guards',
    '<rootDir>/libs/shared/util/logger',
    '<rootDir>/libs/shared/util/timestamp',
    '<rootDir>/libs/shared/util/tools',
    '<rootDir>/libs/shared/util/vendor',
  ],
}
