module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath: 'import io.nativepiece.runtime.NativepieceRuntimePackage;',
        packageInstance: 'new NativepieceRuntimePackage()',
      },
    },
  },
};
