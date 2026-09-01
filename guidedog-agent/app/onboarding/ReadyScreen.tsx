import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  onFinish: (firstCommand?: string) => void;
}

/**
 * Onboarding step 4: Ready screen — onboarding complete.
 *
 * Shown after the user has worked through permissions and model download.
 * Tapping "Start using Deft" calls `onFinish`, which marks onboarding
 * complete and navigates to the main app.
 */
export function ReadyScreen({ onFinish }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.checkCircle}>
          <Text style={styles.checkMark}>&#x2713;</Text>
        </View>

        <Text style={styles.headline}>准备就绪</Text>
        <Text style={styles.subline}>
          豆泡已准备好接管你的手机。点一个指令立即体验，或直接开始。
        </Text>

        <View style={styles.examples}>
          <ExampleCommand
            text="打开设置，开启 Wi-Fi"
            onPress={() => onFinish('打开设置，开启 Wi-Fi')}
          />
          <ExampleCommand
            text="在微信里给妈妈发一条消息"
            onPress={() => onFinish('在微信里给妈妈发一条消息')}
          />
          <ExampleCommand
            text="开启勿扰模式"
            onPress={() => onFinish('开启勿扰模式')}
          />
        </View>

        <View style={styles.spacer} />

        <TouchableOpacity style={styles.button} onPress={() => onFinish()} activeOpacity={0.85}>
          <Text style={styles.buttonText}>开始使用</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function ExampleCommand({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.exampleCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.micDot} />
      <Text style={styles.exampleText}>{'"'}{text}{'"'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 40,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  checkMark: {
    fontSize: 36,
    color: '#FFFFFF',
  },
  headline: {
    fontSize: 34,
    fontWeight: '700',
    color: '#1F2329',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subline: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  examples: {
    width: '100%',
    gap: 10,
  },
  exampleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  micDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    flexShrink: 0,
  },
  exampleText: {
    fontSize: 14,
    color: '#3C4048',
    flex: 1,
    lineHeight: 20,
  },
  spacer: {
    flex: 1,
  },
  button: {
    backgroundColor: '#10B981',
    borderRadius: 16,
    paddingVertical: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
