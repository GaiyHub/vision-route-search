import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Settings } from '../../src/store/settingsStore';
import {
  findModelSuggestions,
  getModelCatalog,
  loadModelCatalog,
  subscribeModelCatalog,
  type ModelCatalogEntry,
} from '../../src/modelCatalog/modelCatalog';

interface Props {
  value: string;
  placeholder: string;
  provider: Settings['cloudProvider'];
  customBaseUrl: string;
  onChangeText: (value: string) => void;
}

export function ModelSuggestInput({
  value,
  placeholder,
  provider,
  customBaseUrl,
  onChangeText,
}: Props) {
  const [entries, setEntries] = useState<ModelCatalogEntry[]>(getModelCatalog());
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void loadModelCatalog().then(setEntries);
    const unsubscribe = subscribeModelCatalog(setEntries);
    return () => {
      unsubscribe();
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  const suggestions = useMemo(
    () => findModelSuggestions(entries, value, provider, customBaseUrl),
    [entries, value, provider, customBaseUrl],
  );
  const exactMatch = entries.some((entry) => entry.id.toLowerCase() === value.trim().toLowerCase());

  const select = (entry: ModelCatalogEntry) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    onChangeText(entry.id);
    setOpen(false);
    Keyboard.dismiss();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <Text style={styles.label}>模型</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={(next) => {
            onChangeText(next);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          placeholder={placeholder}
          placeholderTextColor="#6B7280"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel="云端模型"
        />
      </View>
      {open && (
        <View style={styles.suggestions}>
          {suggestions.map((entry) => (
            <TouchableOpacity
              key={`${entry.source}:${entry.provider}:${entry.id}`}
              style={styles.suggestion}
              onPressIn={() => select(entry)}
              activeOpacity={0.7}
            >
              <View style={styles.suggestionTextWrap}>
                <Text style={styles.suggestionName} numberOfLines={1}>{entry.name}</Text>
                <Text style={styles.suggestionId} numberOfLines={1}>{entry.id}</Text>
              </View>
              <Text style={[styles.badge, entry.verified && styles.verifiedBadge]} numberOfLines={1}>
                {entry.verified ? '当前接口' : entry.provider}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={styles.manualHint}>
            <Text style={styles.manualHintText} numberOfLines={1}>
              {value.trim() && !exactMatch
                ? `可直接使用自定义模型 ID：${value.trim()}`
                : '支持关键词搜索，也可直接输入任意模型 ID'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 15,
    color: '#3C4048',
  },
  input: {
    flex: 2,
    fontSize: 13,
    color: '#3C4048',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  suggestions: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  suggestionTextWrap: {
    flex: 1,
  },
  suggestionName: {
    color: '#1F2329',
    fontSize: 13,
    fontWeight: '600',
  },
  suggestionId: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 2,
  },
  badge: {
    maxWidth: 92,
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 10,
    overflow: 'hidden',
  },
  verifiedBadge: {
    color: '#047857',
    backgroundColor: '#D1FAE5',
  },
  manualHint: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F9FAFB',
  },
  manualHintText: {
    color: '#6B7280',
    fontSize: 11,
  },
});
