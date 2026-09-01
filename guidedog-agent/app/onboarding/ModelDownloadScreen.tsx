import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { downloadModel, hasEnoughRamForOnDevice, MIN_DEVICE_RAM_GB } from '../../src/agent/modelManager';
import { saveSettings } from '../../src/store/settingsStore';

interface Props {
  onNext: () => void;
}

type DownloadStatus = 'idle' | 'downloading' | 'complete' | 'error';

const MODEL_NAME = 'Gemma 4 E4B';
/** Approx. download size string for display. */
const MODEL_SIZE = '2.5 GB';

/**
 * Onboarding step 3: Download the Gemma 4 model with a progress bar.
 *
 * The actual download is performed by react-native-executorch's model
 * download API. This screen provides a progress UI and handles the
 * success/error states. If the module is not yet linked, it simulates
 * progress for UI development purposes (debug-only).
 */
export function ModelDownloadScreen({ onNext }: Props) {
  const [status, setStatus] = useState<DownloadStatus>('idle');
  const [progress, setProgress] = useState(0); // 0-1
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Devices below the RAM floor can't run the on-device model at all — route
  // straight to cloud mode instead of showing a download that will just fail.
  const [lowRam] = useState(() => !hasEnoughRamForOnDevice());
  // Cloud-first by default: the API config screen is shown first, with the
  // local model download as the secondary option.
  const [showCloudMode, setShowCloudMode] = useState(true);
  const [cloudBaseUrl, setCloudBaseUrl] = useState('');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [savingCloud, setSavingCloud] = useState(false);

  // Animated width for the progress bar
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Keep the animated value in sync with numeric progress
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [progress, progressAnim]);

  const startDownload = async () => {
    setStatus('downloading');
    setProgress(0);
    setErrorMessage(null);

    try {
      await downloadModel('E4B', {
        onProgress: (p) => setProgress(p),
        onComplete: () => {
          setStatus('complete');
          setProgress(1);
        },
        onError: (msg) => {
          setStatus('error');
          setErrorMessage(msg);
        },
      });
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const saveCloudMode = async () => {
    if (!cloudApiKey.trim()) return;
    setSavingCloud(true);
    await saveSettings({
      providerMode: 'cloud',
      cloudBaseUrl: cloudBaseUrl.trim(),
      cloudApiKey: cloudApiKey.trim(),
    });
    setSavingCloud(false);
    onNext();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        // Android already uses windowSoftInputMode="adjustResize". Applying
        // KAV's "height" behavior as well shrinks this screen twice and makes
        // the flex-sized model card reposition its inputs when IME opens.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.badge}>
            <Text style={styles.badgeStep}>第 4 步 · 共 4 步</Text>
          </View>

          <Text style={styles.headline}>
            {showCloudMode ? '使用云端 API' : '下载 AI 模型'}
          </Text>
          <Text style={styles.subline}>
            {lowRam
              ? `这台设备内存不足（至少需要 ${MIN_DEVICE_RAM_GB} GB）无法运行本地 ${MODEL_NAME}。请填写 API Key 改用云端推理。`
              : showCloudMode
                ? '填写 API Key 即可使用云端推理，之后可在设置中切换回本地模型。'
                : `豆泡将 ${MODEL_NAME} 完全运行在你的手机上，下载一次即可永久本地推理。`}
          </Text>

          {showCloudMode ? (
            <View style={styles.modelCard}>
              <Text style={styles.cloudLabel}>API 地址</Text>
              <TextInput
                style={styles.cloudInput}
                placeholder="https://api.openai.com/v1"
                placeholderTextColor="#9CA3AF"
                value={cloudBaseUrl}
                onChangeText={setCloudBaseUrl}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.cloudLabel}>API Key</Text>
              <TextInput
                style={styles.cloudInput}
                placeholder="sk-..."
                placeholderTextColor="#9CA3AF"
                value={cloudApiKey}
                onChangeText={setCloudApiKey}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.cloudHint}>
                支持 Anthropic、OpenAI 及各类 OpenAI 兼容服务。密钥仅保存在本机，不会上传。
              </Text>
            </View>
          ) : (
            <View style={styles.modelCard}>
              <View style={styles.modelRow}>
                <Text style={styles.modelName}>{MODEL_NAME}</Text>
                <Text style={styles.modelSize}>{MODEL_SIZE}</Text>
              </View>

              <View style={styles.specRow}>
                <Spec label="参数" value="4B" />
                <Spec label="量化" value="Q4_K_M" />
                <Spec label="上下文" value="8K" />
              </View>

              {(status === 'downloading' || status === 'complete') && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressTrack}>
                    <Animated.View
                      style={[
                        styles.progressFill,
                        {
                          width: progressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressLabel}>
                    {status === 'complete'
                      ? '下载完成'
                      : `${Math.round(progress * 100)}%`}
                  </Text>
                </View>
              )}

              {status === 'error' && errorMessage && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.buttonArea}>
            {showCloudMode ? (
              <>
                <TouchableOpacity
                  style={[styles.button, !cloudApiKey.trim() && styles.buttonDisabled]}
                  onPress={saveCloudMode}
                  activeOpacity={0.85}
                  disabled={!cloudApiKey.trim() || savingCloud}
                >
                  <Text style={[styles.buttonText, !cloudApiKey.trim() && styles.buttonTextDim]}>
                    {savingCloud ? '保存中…' : '保存并继续'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.skipButton} onPress={onNext} activeOpacity={0.7}>
                  <Text style={styles.skipText}>暂时跳过，稍后在设置中配置</Text>
                </TouchableOpacity>
                {!lowRam && (
                  <TouchableOpacity style={styles.skipButton} onPress={() => setShowCloudMode(false)}>
                    <Text style={styles.skipText}>返回下载模型</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <>
                {status === 'idle' || status === 'error' ? (
                  <TouchableOpacity style={styles.button} onPress={startDownload} activeOpacity={0.85}>
                    <Text style={styles.buttonText}>
                      {status === 'error' ? '重新下载' : '下载模型'}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {status === 'downloading' && (
                  <View style={[styles.button, styles.buttonDisabled]}>
                    <Text style={styles.buttonText}>下载中…</Text>
                  </View>
                )}

                {status === 'complete' && (
                  <TouchableOpacity style={styles.button} onPress={onNext} activeOpacity={0.85}>
                    <Text style={styles.buttonText}>继续</Text>
                  </TouchableOpacity>
                )}

                {status !== 'complete' && (
                  <TouchableOpacity style={styles.skipButton} onPress={onNext}>
                    <Text style={styles.skipText}>
                      {status === 'downloading' ? '后台继续下载' : '暂时跳过'}
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.cloudToggle}
                  onPress={() => setShowCloudMode(true)}
                >
                  <Text style={styles.cloudToggleText}>改用云端 API →</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.spec}>
      <Text style={styles.specLabel}>{label}</Text>
      <Text style={styles.specValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 40,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E7F8EF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 24,
  },
  badgeStep: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
  },
  headline: {
    fontSize: 30,
    fontWeight: '700',
    color: '#1F2329',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subline: {
    fontSize: 16,
    color: '#6B7280',
    lineHeight: 24,
    marginBottom: 32,
  },
  modelCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 16,
  },
  modelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modelName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2329',
  },
  modelSize: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  specRow: {
    flexDirection: 'row',
    gap: 12,
  },
  spec: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  specLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  specValue: {
    fontSize: 14,
    color: '#1F2329',
    fontWeight: '600',
  },
  progressContainer: {
    gap: 8,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#E9ECF0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
  },
  errorBanner: {
    backgroundColor: '#FDECEC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    fontSize: 13,
    color: '#f87171',
    lineHeight: 20,
  },
  buttonArea: {
    marginTop: 'auto',
    paddingTop: 24,
    gap: 4,
  },
  button: {
    backgroundColor: '#10B981',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#A7F3D0',
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 15,
    color: '#6B7280',
  },
  cloudToggle: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  cloudToggleText: {
    fontSize: 14,
    color: '#6B7280',
  },
  cloudLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  cloudInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    color: '#1F2329',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  cloudHint: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 20,
  },
  buttonTextDim: {
    color: '#6B7280',
  },
});
