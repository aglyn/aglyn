Pod::Spec.new do |s|
  s.name           = 'TapToPayEducation'
  s.version        = '1.0.0'
  s.summary        = 'Apple Tap to Pay merchant education for Aglyn POS'
  s.description    = 'Presents ProximityReaderDiscovery How to Tap content.'
  s.author         = 'Aglyn LLC'
  s.homepage       = 'https://aglyn.com'
  s.license        = { :type => 'Apache-2.0' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'ProximityReader'
  s.source_files   = '**/*.{h,m,swift}'
end
