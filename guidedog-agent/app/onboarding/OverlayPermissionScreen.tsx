import React, { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  onNext: () => void;
}

/**
 * Onboarding step 3: Request "Draw over other apps" permission.
 *
 * SYSTEM_ALERT_WINDOW lets Deft show a floating agent-status overlay on top
 * of any app while the agent is running. It cannot be granted programmatically
 * — the user must toggle it in Android Settings.
 *
 * This screen provides step-by-step instructions and a direct link to the
 * relevant settings page. The permission is optional; the agent works without
 * it (the floating overlay simply won't appear).
 */
export function OverlayPermissionScreen({ onNext }: Props) {
  const [isGranted, setIsGranted] = useState(false);

  const check = useCallback(async () => {
    const granted = await checkOverlayPermission();
    setIsGranted(granted);
    if (granted) onNext();
  }, [onNext]);

  // Check on mount and each time the user returns from Settings
  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const openSettings = () => {
    if (Platform.OS === 'android') {
      // Opens the specific "Draw over other apps" page for this package.
      Linking.sendIntent('android.settings.action.MANAGE_OVERLAY_PERMISSION', [
        { key: 'package', value: 'tech.bedda.deft' },
      ]).catch(() => {
        // Fallback: open general app settings if the specific intent fails
        Linking.openSettings();
      });
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.badge}>
          <Text style={styles.badgeStep}>第 3 步 · 共 4 步</Text>
        </View>

        <Text style={styles.headline}>开启悬浮窗权限</Text>
        <Text style={styles.subline}>
          允许豆泡在其他应用上方显示悬浮状态球，方便你随时查看执行进度并一键停止。
        </Text>

        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>开启步骤</Text>
          <InstructionStep number={1} text="点击下方的「打开设置」" />
          <InstructionStep number={2} text="在列表中找到「豆泡」" />
          <InstructionStep number={3} text="开启「显示在其他应用上层」" />
          <InstructionStep number={4} text="返回豆泡" />
        </View>

        <View style={styles.optionalNote}>
          <Text style={styles.optionalTitle}>可选</Text>
          <Text style={styles.optionalText}>
            不开也能正常执行任务，只是执行期间看不到悬浮状态球。
          </Text>
        </View>

        {isGranted ? (
          <View style={styles.grantedBanner}>
            <Text style={styles.grantedText}>权限已开启</Text>
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
 * Check whether SYSTEM_ALERT_WINDOW ("Draw over other apps") is granted.
 *
 * Uses react-native-accessibility-controller's canDrawOverlays if available,
 * otherwise returns false so the screen is shown but skippable.
 */
async function checkOverlayPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ctrl = require('react-native-accessibility-controller');
    if (typeof ctrl.canDrawOverlays === 'function') {
      return (await ctrl.canDrawOverlays()) as boolean;
    }
  } catch {
    // Module not linked
  }
  return false;
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
  optionalNote: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 32,
    gap: 6,
  },
  optionalTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  optionalText: {
    fontSize: 13,
    color: '#6B7280',
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
