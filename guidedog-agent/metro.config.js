// Metro configuration for WatchDog.
//
// The native device-control libraries (react-native-accessibility-controller,
// react-native-executorch) are file: dependencies living outside the project
// root (sibling directories in the workspace). Metro only watches the project
// root by default, so release JS bundling fails to resolve those symlinked
// packages. Watch the workspace root and expose each package's node_modules so
// Metro can resolve both the packages and their transitive JS dependencies.
//
// Dev-environment artifacts (node_modules, build caches) live one level up in
// `doupao-dev-env/` with symlinks back into the workspace; point
// nodeModulesPaths at the real locations so Metro resolves through symlinks.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const devEnvRoot = path.resolve(workspaceRoot, '..', 'doupao-dev-env');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [
  workspaceRoot,
  devEnvRoot,
  path.resolve(workspaceRoot, 'react-native-accessibility-controller'),
  // Executorch moved OUT of the workspace (see the repo cleanup) — it now
  // lives one level above, next to the workspace and the dev-env dir.
  path.resolve(workspaceRoot, '..', 'react-native-executorch', 'packages', 'react-native-executorch'),
];

config.resolver.nodeModulesPaths = [
  // Prefer the project's installed dependencies. This also works when
  // node_modules is a real directory instead of the dev-env symlink.
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(devEnvRoot, 'guidedog-agent', 'node_modules'),
  path.resolve(devEnvRoot, 'react-native-accessibility-controller', 'node_modules'),
  path.resolve(devEnvRoot, 'react-native-executorch', 'packages', 'react-native-executorch', 'node_modules'),
];

module.exports = config;
