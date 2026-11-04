Pod::Spec.new do |s|
  s.name           = 'ARJig'
  s.version        = '1.0.0'
  s.summary        = 'ARKit + LiDAR spatial-gate capture for PosturePulse assessments'
  s.description    = 'Places a metric 60x40cm floor template with ARKit scene reconstruction, ' \
                     'gates recording on camera level/height/distance/foreground clearance, and ' \
                     'records a clip plus per-frame gravity in the clip-capture.schema.json camera frame.'
  s.author         = 'beAIve'
  s.homepage       = 'https://docs.expo.dev/modules/'
  # iOS only: ARKit and RealityKit are not available on tvOS.
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks = 'ARKit', 'RealityKit', 'AVFoundation', 'CoreVideo'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
