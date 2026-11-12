// React Native CLI autolinking configuration. Expo and the RN CLI pick the
// Android module and the iOS pod up from here, so apps only need to install
// the package and rebuild.
module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath: 'import com.rozenite.nativenetwork.NativeNetworkPackage;',
        packageInstance: 'new NativeNetworkPackage()',
      },
      ios: {},
    },
  },
};
