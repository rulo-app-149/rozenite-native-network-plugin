require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "RozeniteNativeNetwork"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"] || "https://github.com/rulo-app-149/rozenite-native-network-plugin"
  s.license      = package["license"]
  s.authors      = { "rozenite-native-network-plugin contributors" => "noreply@example.com" }
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => "https://github.com/rulo-app-149/rozenite-native-network-plugin.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm}"
  s.requires_arc = true

  # `install_modules_dependencies` exists from React Native 0.71 and wires
  # the right React-Core / new-architecture dependencies for the app's RN.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
