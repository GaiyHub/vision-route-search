import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const EXAMPLE_COMMANDS = [
  '打开设置，开启 Wi-Fi',
  '在微信里给妈妈发一条消息',
  '开启勿扰模式',
  '设置明早 7 点的闹钟',
  '打开抖音，搜索美食视频',
] as const;

const COMMAND_LANES = [
  [EXAMPLE_COMMANDS[0], EXAMPLE_COMMANDS[3]],
  [EXAMPLE_COMMANDS[1], EXAMPLE_COMMANDS[4]],
  [EXAMPLE_COMMANDS[2], EXAMPLE_COMMANDS[0]],
] as const;

interface Props {
  onNext: () => void;
}

/**
 * Onboarding step 1: Explain what WatchDog does and show concrete command examples.
 */
export function WelcomeScreen({ onNext }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.badge}>
          <Text style={styles.badgeStep}>第 1 步 · 共 4 步</Text>
        </View>

        <View style={styles.iconPlaceholder}>
          <Text style={styles.iconText}>W</Text>
        </View>

        <Text style={styles.headline}>欢迎使用豆泡</Text>
        <Text style={styles.tagline}>你的 AI 手机助手，会听、会看、会操作</Text>

        <View style={styles.features}>
          <FeatureRow
            title="用一句话指挥手机"
            description="说出或输入任务，豆泡读取屏幕、点击、输入、滑动，帮你完成操作。"
          />
          <FeatureRow
            title="兼容各类应用"
            description="微信、抖音、设置、浏览器…… 屏幕上看得到的，豆泡都能帮你操作。"
          />
        </View>

        <View style={styles.examplesSection}>
          <Text style={styles.examplesLabel}>试试这些指令</Text>
          <CommandBarrage />
        </View>

        <TouchableOpacity style={styles.button} onPress={onNext} activeOpacity={0.85}>
          <Text style={styles.buttonText}>开始使用</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function FeatureRow({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureDot} />
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDescription}>{description}</Text>
      </View>
    </View>
  );
}

function CommandBarrage() {
  const [width, setWidth] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  return (
    <View
      style={styles.barrage}
      onLayout={handleLayout}
      accessibilityLabel={`示例指令：${EXAMPLE_COMMANDS.join('；')}`}
    >
      {COMMAND_LANES.map((commands, index) => (
        <BarrageLane
          key={index}
          commands={commands}
          containerWidth={width}
          speed={index === 1 ? 34 : index === 2 ? 30 : 38}
          initialProgress={index === 0 ? 0.28 : index === 1 ? 0.52 : 0.12}
        />
      ))}
    </View>
  );
}

function BarrageLane({
  commands,
  containerWidth,
  speed,
  initialProgress,
}: {
  commands: readonly string[];
  containerWidth: number;
  speed: number;
  initialProgress: number;
}) {
  const progress = useRef(new Animated.Value(initialProgress)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    if (containerWidth <= 0 || trackWidth <= 0) return undefined;

    const distance = containerWidth + trackWidth;
    const duration = Math.round((distance / speed) * 1000);
    progress.setValue(initialProgress);
    let loop: Animated.CompositeAnimation | undefined;
    const firstPass = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(1, Math.round(duration * (1 - initialProgress))),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    firstPass.start(({ finished }) => {
      if (!finished) return;
      progress.setValue(0);
      loop = Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
    });
    return () => {
      firstPass.stop();
      loop?.stop();
    };
  }, [containerWidth, initialProgress, progress, speed, trackWidth]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-trackWidth, containerWidth],
  });

  return (
    <View style={styles.barrageLane} accessible={false}>
      <Animated.View
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        style={[styles.barrageTrack, { transform: [{ translateX }] }]}
      >
        {commands.map((text, index) => (
          <CommandChip key={`${text}-${index}`} text={text} />
        ))}
      </Animated.View>
    </View>
  );
}

function CommandChip({ text }: { text: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{'“'}{text}{'”'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 48,
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
  iconPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 28,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconText: {
    fontSize: 44,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headline: {
    fontSize: 34,
    fontWeight: '700',
    color: '#1F2329',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 17,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 40,
  },
  features: {
    width: '100%',
    gap: 24,
    marginBottom: 36,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  featureDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginTop: 6,
    flexShrink: 0,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2329',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  examplesSection: {
    width: '100%',
    marginBottom: 36,
  },
  examplesLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  barrage: {
    height: 134,
    marginHorizontal: -28,
    overflow: 'hidden',
    gap: 7,
  },
  barrageLane: {
    height: 40,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  barrageTrack: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#111827',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  chipText: {
    fontSize: 14,
    color: '#3C4048',
    lineHeight: 18,
  },
  button: {
    backgroundColor: '#10B981',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 40,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
