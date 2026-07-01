import * as Aglyn from '@aglyn/aglyn'
import { PLUGIN_ID } from './constants/common'
import './aglyn-plugin-mui'

describe('AglynPluginMui', () => {
  it('registers the mui plugin dependency on import', () => {
    expect(Aglyn.plugins.getDependency(PLUGIN_ID)).toBeTruthy()
  })
})
