const plugin = require('../../../plugins/withDeftForegroundService') as {
  patchEvaluationBuildType: (contents: string) => string;
};

const generatedGradle = `
android {
    defaultConfig {
        applicationId 'com.watchdog.agent'
        buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL", "stable"
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
    packagingOptions {
    }
}
`;

describe('evaluation Gradle build type patch', () => {
  test('adds an isolated compile-time flag without changing applicationId', () => {
    const result = plugin.patchEvaluationBuildType(generatedGradle);

    expect(result).toContain('buildConfigField "boolean", "EVALUATION_ENABLED", "false"');
    expect(result).toContain('evaluation {');
    expect(result).toContain('initWith release');
    expect(result).toContain('buildConfigField "boolean", "EVALUATION_ENABLED", "true"');
    expect(result).toContain("applicationId 'com.watchdog.agent'");
    expect(result).not.toContain('applicationIdSuffix');
  });

  test('is idempotent across repeated Expo prebuilds', () => {
    const once = plugin.patchEvaluationBuildType(generatedGradle);
    expect(plugin.patchEvaluationBuildType(once)).toBe(once);
    expect(once.match(/evaluation \{/g)).toHaveLength(1);
  });
});
