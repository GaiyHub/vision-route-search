import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Platform,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  onNext: () => void;
}

/**
 * Onboarding step 2: Request Android AccessibilityService permission.
 *
 * The AccessibilityService cannot be enabled programmatically -- the user
 * must go to Settings > Accessibility > Deft and toggle it on. This screen
 * gives clear instructions and polls for the service becoming active.
 */
export function PermissionsScreen({ onNext }: Props) {
  const [isGranted, setIsGranted] = useState(false);

  // Poll for service activation each time the app comes back to foreground
  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const granted = await checkAccessibilityServiceEnabled();
      if (mounted) setIsGranted(granted);
      if (granted && mounted) onNext();
    };

    check();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check();
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [onNext]);

  const openSettings = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() => {
        Linking.openSettings();
      });
    } else {
      Linking.openSettings();
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.badge}>
          <Text style={styles.badgeStep}>第 2 步 · 共 4 步</Text>
        </View>

        <Text style={styles.headline}>开启无障碍服务</Text>
        <Text style={styles.subline}>
          豆泡需要 Android 无障碍服务来读取屏幕内容，并代替你执行点击、输入等操作。
        </Text>

        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>开启步骤</Text>
          <InstructionStep number={1} text="点击下方的「打开设置」" />
          <InstructionStep number={2} text="选择「已安装的服务」" />
          <InstructionStep number={3} text="点击「豆泡」" />
          <InstructionStep number={4} text="把开关切换到开启状态" />
          <InstructionStep number={5} text="返回豆泡" />
        </View>

        <View style={styles.privacyNote}>
          <Text style={styles.privacyText}>
            豆泡仅在执行你的指令时读取屏幕，不会记录、存储或上传你的屏幕内容。
          </Text>
        </View>

        {isGranted ? (
          <View style={styles.grantedBanner}>
            <Text style={styles.grantedText}>无障碍服务已开启</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.button} onPress={openSettings} activeOpacity={0.85}>
            <Text style={styles.buttonText}>打开设置</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.skipButton} onPress={onNext}>
          <Text style={styles.skipText}>暂时跳过</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function InstructionStep({ number, text }: { number: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

/**
 * Check whether the Deft AccessibilityService is currently enabled.
 *
 * This relies on react-native-accessibility-controller's `isServiceEnabled`
 * method. If the native module isn't linked yet, it returns false gracefully.
 */
async function checkAccessibilityServiceEnabled(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const controller = require('react-native-accessibility-controller');
    return (await controller.isServiceEnabled()) as boolean;
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F6F7F9',
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
  stepsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 20,
    gap: 14,
  },
  stepsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stepText: {
    fontSize: 15,
    color: '#3C4048',
    flex: 1,
  },
  privacyNote: {
    backgroundColor: '#E7F8EF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginBottom: 32,
  },
  privacyText: {
    fontSize: 13,
    color: '#059669',
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#10B981',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  grantedBanner: {
    backgroundColor: '#E7F8EF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginBottom: 12,
  },
  grantedText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#059669',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 15,
    color: '#6B7280',
  },
});
