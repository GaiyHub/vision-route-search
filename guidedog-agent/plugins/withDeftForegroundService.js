// @ts-check
const { withAndroidManifest, withDangerousMod, withAppBuildGradle } = require('@expo/config-plugins');

const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin: adds the DeftAgentService foreground service to the Android build.
 *
 * What it does on `expo prebuild`:
 *   1. Adds FOREGROUND_SERVICE (+ FOREGROUND_SERVICE_SPECIAL_USE on API 34+) permissions.
 *   2. Declares DeftAgentService in AndroidManifest.xml.
 *   3. Copies DeftAgentService.kt / DeftAgentModule.kt / DeftAgentPackage.kt into the
 *      generated android/app/src/main/java/tech/bedda/deft/ directory.
 *   4. Patches MainApplication.kt to register DeftAgentPackage.
 */

// ─── Step 1: AndroidManifest.xml ─────────────────────────────────────────────

function withManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Permissions
    if (!manifest['uses-permission']) manifest['uses-permission'] = [];
    const perms = manifest['uses-permission'];

    const ensurePerm = (name, extra) => {
      if (!perms.some((p) => p.$['android:name'] === name)) {
        perms.push({ $: { 'android:name': name, ...extra } });
      }
    };

    ensurePerm('android.permission.FOREGROUND_SERVICE');
    ensurePerm('android.permission.FOREGROUND_SERVICE_SPECIAL_USE', {
      'android:minSdkVersion': '34',
    });
    ensurePerm('android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION');

    // Service declaration
    const app = manifest.application[0];
    if (!app.service) app.service = [];

    const serviceExists = app.service.some(
      (s) => s.$['android:name'] === '.DeftAgentService',
    );
    if (!serviceExists) {
      app.service.push({
        $: {
          'android:name': '.DeftAgentService',
          'android:enabled': 'true',
          'android:exported': 'false',
          'android:foregroundServiceType': 'specialUse',
        },
        'property': [
          {
            $: {
              'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
              'android:value': 'agent_task',
            },
          },
        ],
      });
    }

    // MediaProjection foreground service (MobileAgent pattern: anchors the
    // process and creates the projection in service context).
    const projServiceExists = app.service.some(
      (s) => s.$['android:name'] === '.DeftProjectionService',
    );
    if (!projServiceExists) {
      app.service.push({
        $: {
          'android:name': '.DeftProjectionService',
          'android:enabled': 'true',
          'android:exported': 'false',
          'android:foregroundServiceType': 'mediaProjection',
        },
      });
    }

    // Freeze-safe heartbeat/wakeup receiver.
    if (!app.receiver) app.receiver = [];
    const receiverExists = app.receiver.some(
      (r) => r.$['android:name'] === '.HeartbeatReceiver',
    );
    if (!receiverExists) {
      app.receiver.push({
        $: {
          'android:name': '.HeartbeatReceiver',
          'android:enabled': 'true',
          'android:exported': 'false',
        },
      });
    }
    for (const receiverName of [
      '.CompletionReceiver',
      '.RiskConfirmReceiver',
      '.UserActionReceiver',
      '.OverlayTextInputReceiver',
    ]) {
      if (!app.receiver.some((receiver) => receiver.$['android:name'] === receiverName)) {
        app.receiver.push({
          $: {
            'android:name': receiverName,
            'android:enabled': 'true',
            'android:exported': 'false',
          },
        });
      }
    }
    // The accessibility-controller overlay broadcasts package-scoped
    // completion actions because it cannot reference the host receiver class.
    // Keep the intent filter in generated builds, including the third
    // 补充信息 choice.
    const completionReceiver = app.receiver.find(
      (receiver) => receiver.$['android:name'] === '.CompletionReceiver',
    );
    if (completionReceiver) {
      const actions = [
        'tech.bedda.deft.CONFIRM_COMPLETE',
        'tech.bedda.deft.REJECT_COMPLETE',
        'tech.bedda.deft.SUPPLEMENT_COMPLETE',
      ];
      completionReceiver['intent-filter'] = [{
        action: actions.map((name) => ({ $: { 'android:name': name } })),
      }];
    }
    const userActionReceiver = app.receiver.find(
      (receiver) => receiver.$['android:name'] === '.UserActionReceiver',
    );
    if (userActionReceiver) {
      userActionReceiver['intent-filter'] = [{
        action: [{ $: { 'android:name': 'tech.bedda.deft.USER_ACTION_COMPLETE' } }],
      }];
    }
    const overlayTextInputReceiver = app.receiver.find(
      (receiver) => receiver.$['android:name'] === '.OverlayTextInputReceiver',
    );
    if (overlayTextInputReceiver) {
      overlayTextInputReceiver['intent-filter'] = [{
        action: [{ $: { 'android:name': 'tech.bedda.deft.OVERLAY_TEXT_INPUT' } }],
      }];
    }

    return cfg;
  });
}

/**
 * Restrict native libraries to the phone ABI (arm64-v8a). Keeps the build
 * small and the APK lean; the generated android/app/build.gradle is
 * overwritten by every `expo prebuild`, so this must be patched here rather
 * than edited in place.
 */
function withAbiFilter(config) {
  return withAppBuildGradle(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (contents.includes("abiFilters 'arm64-v8a'")) return cfg;
    cfg.modResults.contents = contents.replace(
      /(buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL"[^\n]*\n)/,
      `$1        ndk {\n            abiFilters 'arm64-v8a'\n        }\n`,
    );
    return cfg;
  });
}

/**
 * Keep the JS entry of the local accessibility-controller package synchronized
 * before Metro creates an Android bundle. The package's `main` points at
 * lib/commonjs, which is intentionally gitignored and therefore must be built
 * from src as part of the native build.
 */
function withAccessibilityControllerJsBuild(config) {
  return withAppBuildGradle(config, (cfg) => {
    const marker = 'buildAccessibilityControllerJs';
    if (cfg.modResults.contents.includes(marker)) return cfg;

    const block = `
def accessibilityControllerRoot = new File(projectRoot, "../react-native-accessibility-controller")

tasks.register("buildAccessibilityControllerJs", Exec) {
    workingDir accessibilityControllerRoot
    commandLine "npm", "run", "build"
    inputs.dir new File(accessibilityControllerRoot, "src")
    inputs.files(
        new File(accessibilityControllerRoot, "package.json"),
        new File(accessibilityControllerRoot, "tsconfig.json"),
        new File(accessibilityControllerRoot, "tsconfig.build.json")
    )
    outputs.dir new File(accessibilityControllerRoot, "lib")
}

tasks.named("preBuild").configure {
    dependsOn "buildAccessibilityControllerJs"
}

tasks.configureEach { task ->
    if (task.name.endsWith("JsAndAssets")) {
        task.dependsOn "buildAccessibilityControllerJs"
        task.inputs.dir new File(accessibilityControllerRoot, "lib/commonjs")
    }
}
`;

    cfg.modResults.contents = cfg.modResults.contents.replace(
      /(def projectRoot =[^\n]*\n)/,
      `$1${block}`,
    );
    return cfg;
  });
}

/**
 * Keep the generated Android shell sources synchronized for every Gradle
 * build. Expo prebuild copies these files too, but developers commonly build
 * the existing android directory directly; without this task that directory
 * can silently compile an older router than the model-facing tool metadata.
 */
function withShellKotlinBuildSync(config) {
  return withAppBuildGradle(config, (cfg) => {
    const marker = 'syncDeftShellSources';
    if (cfg.modResults.contents.includes(marker)) return cfg;

    const block = `
def deftShellSourceDir = new File(projectRoot, "plugins/android/shell")
def deftShellTargetDir = new File(projectDir, "src/main/java/com/watchdog/agent/shell")

tasks.register("syncDeftShellSources", Sync) {
    from deftShellSourceDir
    into deftShellTargetDir
    include "*.kt"
}

tasks.named("preBuild").configure {
    dependsOn "syncDeftShellSources"
}
`;

    cfg.modResults.contents = cfg.modResults.contents.replace(
      /(def projectRoot =[^\n]*\n)/,
      `$1${block}`,
    );
    return cfg;
  });
}

// ─── Step 2 & 3: Copy Kotlin files + patch MainApplication.kt ────────────────

function withKotlinFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.platformProjectRoot; // …/android
      const packageDir = path.join(
        projectRoot,
        'app', 'src', 'main', 'java', 'com', 'watchdog', 'agent',
      );
      const pluginAndroidDir = path.join(
        cfg.modRequest.projectRoot,
        'plugins', 'android',
      );

      fs.mkdirSync(packageDir, { recursive: true });

      for (const file of [
        'DeftAgentService.kt',
        'DeftAgentModule.kt',
        'DeftAgentPackage.kt',
        'DeftWatchdogModule.kt',
        'DeftProjectionService.kt',
        'HeartbeatReceiver.kt',
        'CompletionReceiver.kt',
        'RiskConfirmReceiver.kt',
        'UserActionReceiver.kt',
        'OverlayTextInputReceiver.kt',
      ]) {
        fs.copyFileSync(
          path.join(pluginAndroidDir, file),
          path.join(packageDir, file),
        );
      }

      const shellSourceDir = path.join(pluginAndroidDir, 'shell');
      const shellTargetDir = path.join(packageDir, 'shell');
      fs.mkdirSync(shellTargetDir, { recursive: true });
      for (const file of fs.readdirSync(shellSourceDir).filter((name) => name.endsWith('.kt'))) {
        fs.copyFileSync(path.join(shellSourceDir, file), path.join(shellTargetDir, file));
      }
      const shellTestSourceDir = path.join(pluginAndroidDir, 'shell-tests');
      const shellTestTargetDir = path.join(
        projectRoot, 'app', 'src', 'test', 'java', 'com', 'watchdog', 'agent', 'shell',
      );
      fs.mkdirSync(shellTestTargetDir, { recursive: true });
      const shellTestFiles = fs.readdirSync(shellTestSourceDir).filter((name) => name.endsWith('.kt'));
      for (const file of shellTestFiles.filter((name) => !name.endsWith('InstrumentedTest.kt'))) {
        fs.copyFileSync(path.join(shellTestSourceDir, file), path.join(shellTestTargetDir, file));
      }
      const shellAndroidTestTargetDir = path.join(
        projectRoot, 'app', 'src', 'androidTest', 'java', 'com', 'watchdog', 'agent', 'shell',
      );
      fs.mkdirSync(shellAndroidTestTargetDir, { recursive: true });
      for (const file of shellTestFiles.filter((name) => name.endsWith('InstrumentedTest.kt'))) {
        fs.copyFileSync(path.join(shellTestSourceDir, file), path.join(shellAndroidTestTargetDir, file));
      }

      const jniTargetDir = path.join(projectRoot, 'app', 'src', 'main', 'jniLibs', 'arm64-v8a');
      fs.mkdirSync(jniTargetDir, { recursive: true });
      fs.copyFileSync(
        path.join(pluginAndroidDir, 'jniLibs', 'arm64-v8a', 'libbusybox.so'),
        path.join(jniTargetDir, 'libbusybox.so'),
      );
      // Clean artifacts generated by versions that bundled Alpine + PRoot.
      const staleProot = path.join(jniTargetDir, 'libproot.so');
      if (fs.existsSync(staleProot)) fs.unlinkSync(staleProot);
      const staleRootfs = path.join(
        projectRoot,
        'app',
        'src',
        'main',
        'assets',
        'shell',
        'alpine-minirootfs-3.21.3-aarch64.rootfs',
      );
      if (fs.existsSync(staleRootfs)) fs.unlinkSync(staleRootfs);

      // Patch MainApplication.kt to register DeftAgentPackage
      const mainAppPath = path.join(packageDir, 'MainApplication.kt');
      if (fs.existsSync(mainAppPath)) {
        let src = fs.readFileSync(mainAppPath, 'utf8');

        // Add package registration inside getPackages() if not already present
        if (!src.includes('DeftAgentPackage')) {
          // Try the standard Expo-generated comment placeholder
          src = src.replace(
            /\/\/ Packages that cannot be autolinked yet[^\n]*/,
            '// Packages that cannot be autolinked yet can be added manually here, for example:\n      add(DeftAgentPackage())',
          );

          // Fallback: insert before the closing brace of the apply block inside getPackages
          if (!src.includes('DeftAgentPackage')) {
            src = src.replace(
              /PackageList\(this\)\.packages\.apply \{/,
              'PackageList(this).packages.apply {\n      add(DeftAgentPackage())',
            );
          }

          fs.writeFileSync(mainAppPath, src, 'utf8');
        }
      }

      return cfg;
    },
  ]);
}

function withShellPackaging(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    contents = contents.replace(/^\s*noCompress \+= \['rootfs'\]\s*\n/m, '');
    if (!contents.includes('testImplementation("junit:junit:4.13.2")')) {
      contents = contents.replace(
        /dependencies \{\n/,
        'dependencies {\n    testImplementation("junit:junit:4.13.2")\n',
      );
    }
    if (!contents.includes("testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner'")) {
      contents = contents.replace(
        /defaultConfig \{\n/,
        "defaultConfig {\n        testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner'\n",
      );
    }
    if (!contents.includes('androidTestImplementation("androidx.test.ext:junit:1.2.1")')) {
      contents = contents.replace(
        /dependencies \{\n/,
        'dependencies {\n    androidTestImplementation("androidx.test.ext:junit:1.2.1")\n    androidTestImplementation("androidx.test:runner:1.6.2")\n',
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

// ─── Step 4: Enforce minSdkVersion 26 ────────────────────────────────────────
// ExpoRootProject (Expo SDK 54+) reads minSdk from android.minSdkVersion in
// gradle.properties, not from app/build.gradle. Write directly to gradle.properties
// so both ExpoRootProject and the manifest merger see 26.

function withAndroidBuildProperties(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const androidDir = cfg.modRequest.platformProjectRoot;
      const propsPath = path.join(androidDir, 'gradle.properties');

      let content = fs.existsSync(propsPath)
        ? fs.readFileSync(propsPath, 'utf8')
        : '';

      if (/^android\.minSdkVersion\s*=/m.test(content)) {
        content = content.replace(
          /^(android\.minSdkVersion\s*=\s*)\d+/m,
          (_, prefix) => `${prefix}26`,
        );
      } else {
        content += '\nandroid.minSdkVersion=26\n';
      }

      // BusyBox is launched as a standalone executable, not loaded through
      // System.loadLibrary(). It therefore needs an extracted, executable
      // file in applicationInfo.nativeLibraryDir. Modern uncompressed JNI
      // packaging keeps .so files inside the APK and makes that path absent.
      if (/^expo\.useLegacyPackaging\s*=/m.test(content)) {
        content = content.replace(
          /^(expo\.useLegacyPackaging\s*=\s*)(?:true|false)/m,
          '$1true',
        );
      } else {
        content += '\nexpo.useLegacyPackaging=true\n';
      }

      fs.writeFileSync(propsPath, content, 'utf8');
      return cfg;
    },
  ]);
}

// ─── Compose ──────────────────────────────────────────────────────────────────

/** @type {(config: import('@expo/config-plugins').ExpoConfig) => import('@expo/config-plugins').ExpoConfig} */
const withDeftForegroundService = (config) => {
  config = withManifest(config);
  config = withKotlinFiles(config);
  config = withAndroidBuildProperties(config);
  config = withAbiFilter(config);
  config = withAccessibilityControllerJsBuild(config);
  config = withShellKotlinBuildSync(config);
  config = withShellPackaging(config);
  return config;
};

module.exports = withDeftForegroundService;
