/* eslint-disable */
export default {
  displayName: 'addons-ui-mui-bundle',
  preset: '../../../../jest.preset.js',
  transform: {
    '^.+\\.[tj]sx?$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../../../coverage/libs/addons/ui/mui-bundle',
}
