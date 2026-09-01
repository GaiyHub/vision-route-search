const { applyEvaluationManifest } = require('../../../plugins/withDeftForegroundService') as {
  applyEvaluationManifest: (manifest: Record<string, unknown>) => Record<string, any>;
};

function baseManifest() {
  return {
    application: [{
      $: { 'android:name': '.MainApplication' },
      activity: [{
        $: { 'android:name': '.MainActivity', 'android:exported': 'true' },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
        }],
      }],
    }],
  };
}

describe('普通 APK 评测 Manifest', () => {
  it('声明 API v1 和受 DUMP 权限保护的独立 alias', () => {
    const manifest = applyEvaluationManifest(baseManifest());
    const app = manifest.application[0];
    expect(app['meta-data']).toContainEqual({
      $: { 'android:name': 'com.watchdog.agent.EVALUATION_API_VERSION', 'android:value': '1' },
    });
    expect(app['activity-alias']).toEqual([{
      $: {
        'android:name': '.EvaluationEntryActivity',
        'android:targetActivity': '.MainActivity',
        'android:enabled': 'true',
        'android:exported': 'true',
        'android:permission': 'android.permission.DUMP',
      },
    }]);
  });

  it('重复应用保持幂等且不创建 Launcher 或 Receiver', () => {
    const manifest = baseManifest();
    applyEvaluationManifest(manifest);
    const app = applyEvaluationManifest(manifest).application[0];
    expect(app['activity-alias']).toHaveLength(1);
    expect(app['activity-alias'][0]['intent-filter']).toBeUndefined();
    expect(app.receiver).toBeUndefined();
    expect(app.activity[0]['intent-filter'][0].category[0].$['android:name']).toBe('android.intent.category.LAUNCHER');
  });
});
