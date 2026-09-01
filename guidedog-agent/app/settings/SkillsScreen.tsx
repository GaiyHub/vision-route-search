/**
 * SkillsScreen — experience library management UI.
 *
 * Renders inside the settings tab (the app has no navigation stack; the
 * parent switches views with plain state, following its lightweight pattern).
 * When embedded as a tab the back button is hidden; onBack is only used by
 * standalone parents.
 *
 * Two views:
 *   - List: one card per skill (name + description + update time). Tap to
 *     edit; the delete button needs a second tap to confirm (inline two-step
 *     confirm instead of Alert — the app has no Alert/Modal precedent).
 *   - Editor: name (renamable slug), one-line description, multi-line body.
 *     New records are created, existing ones renamed/updated in place.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  createSkill,
  deleteSkill,
  getSkills,
  renameSkill,
  setSkillDisabled,
  subscribeSkills,
  updateSkill,
  type SkillRecord,
} from '../../src/store/skillStore';
import { isValidSkillName, SKILL_NAME_MAX_LENGTH } from '../../src/agent/skillFile';

interface EditorState {
  /** null for a brand-new skill; otherwise the record id being edited. */
  id: string | null;
  name: string;
  description: string;
  body: string;
}

export function SkillsScreen({ onBack }: { onBack?: () => void }) {
  const [skills, setSkills] = useState<SkillRecord[]>(getSkills());
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const scrollRef = useRef<ScrollView>(null);
  const focusScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFocusedInputAboveKeyboard = (nativeHandle: number) => {
    if (focusScrollTimerRef.current) clearTimeout(focusScrollTimerRef.current);
    // Wait until the keyboard animation has updated the available viewport,
    // then let ScrollView measure the real input bounds against the keyboard.
    focusScrollTimerRef.current = setTimeout(() => {
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        nativeHandle,
        20,
        true,
      );
      focusScrollTimerRef.current = null;
    }, Platform.OS === 'android' ? 250 : 100);
  };

  useEffect(
    () => () => {
      if (focusScrollTimerRef.current) clearTimeout(focusScrollTimerRef.current);
    },
    [],
  );

  useEffect(
    () =>
      subscribeSkills((all) =>
        setSkills(all.filter((s) => s.deletedAt === null)),
      ),
    [],
  );

  const openEditor = (skill: SkillRecord | null) => {
    setConfirmDeleteId(null);
    setError('');
    setEditor(
      skill
        ? { id: skill.id, name: skill.name, description: skill.description, body: skill.body }
        : { id: null, name: '', description: '', body: '' },
    );
  };

  const save = () => {
    if (!editor) return;
    const name = editor.name.trim();
    if (!isValidSkillName(name)) {
      setError(`名称需为 1-${SKILL_NAME_MAX_LENGTH} 字，支持中文、字母、数字、空格、- 和 _`);
      return;
    }
    if (!editor.description.trim()) {
      setError('描述不能为空');
      return;
    }
    const patch = { description: editor.description.trim(), body: editor.body };

    if (editor.id === null) {
      const result = createSkill({ name, ...patch });
      if (!result.ok) {
        setError(result.error ?? '保存失败');
        return;
      }
    } else {
      const existing = getSkills().find((s) => s.id === editor.id);
      if (!existing) {
        setError('经验不存在或已删除');
        return;
      }
      if (existing.name !== name) {
        const renamed = renameSkill(editor.id, name);
        if (!renamed.ok) {
          setError(renamed.error ?? '改名失败');
          return;
        }
      }
      const updated = updateSkill(editor.id, patch);
      if (!updated.ok) {
        setError(updated.error ?? '保存失败');
        return;
      }
    }
    setEditor(null);
    setError('');
  };

  const confirmDelete = (id: string) => {
    if (confirmDeleteId === id) {
      setConfirmDeleteId(null);
      deleteSkill(id);
      if (editor?.id === id) setEditor(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  // Editor view
  if (editor) {
    return (
      <View style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setEditor(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.headerBack}>‹ 返回</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{editor.id === null ? '新增经验' : '编辑经验'}</Text>
          <TouchableOpacity
            onPress={save}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Text style={styles.headerSave}>保存</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.content, styles.editorContent]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          >
            <Text style={styles.fieldLabel}>名称</Text>
            <TextInput
              style={styles.input}
              value={editor.name}
              onChangeText={(v) => setEditor({ ...editor, name: v })}
              onFocus={(event) => scrollFocusedInputAboveKeyboard(event.nativeEvent.target)}
              placeholder="e.g. 支付宝充值"
              placeholderTextColor="#3a3a3a"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              maxLength={SKILL_NAME_MAX_LENGTH}
            />
            <Text style={styles.fieldHint}>
              1-{SKILL_NAME_MAX_LENGTH} 字，支持中文、字母、数字、空格、- 和 _。agent 通过该名称调用 read_skill 加载经验，修改后自动迁移。
            </Text>

            <Text style={styles.fieldLabel}>描述（一句话说明适用场景）</Text>
            <TextInput
              style={styles.input}
              value={editor.description}
              onChangeText={(v) => setEditor({ ...editor, description: v })}
              onFocus={(event) => scrollFocusedInputAboveKeyboard(event.nativeEvent.target)}
              placeholder="e.g. 支付宝充值流程：打开应用后按步骤完成充值"
              placeholderTextColor="#3a3a3a"
              autoCapitalize="sentences"
              autoCorrect
              returnKeyType="next"
            />
            <Text style={styles.fieldHint}>
              描述会注入每次模型调用的提示词，用于让 agent 判断何时加载本经验，务必准确概括场景。
            </Text>

            <Text style={styles.fieldLabel}>操作流程（Markdown 正文）</Text>
            <TextInput
              style={styles.bodyInput}
              value={editor.body}
              onChangeText={(v) => setEditor({ ...editor, body: v })}
              onFocus={(event) => scrollFocusedInputAboveKeyboard(event.nativeEvent.target)}
              placeholder={'## 适用场景\n…\n\n## 操作流程\n1. …\n2. …\n\n## 验证点\n- …\n\n## 陷阱\n- …'}
              placeholderTextColor="#3a3a3a"
              multiline
              autoCapitalize="sentences"
              autoCorrect
              returnKeyType="default"
              textAlignVertical="top"
            />
            <Text style={styles.fieldHint}>正文 {editor.body.length} 字符 · 建议包含：适用场景 / 操作流程 / 验证点 / 陷阱</Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // List view
  return (
    <View style={styles.safe}>
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.headerBack}>‹ 设置</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
        <Text style={styles.headerTitle}>经验库</Text>
        <TouchableOpacity
          onPress={() => openEditor(null)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Text style={styles.headerSave}>新增</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {skills.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>暂无经验</Text>
            <Text style={styles.emptyText}>
              经验库用于存放你在特定场景下的操作流程（SKILL.md 格式）。agent 遇到匹配场景时会按需加载经验指导，减少试错、节省 token。点击右上角「新增」创建第一条经验。
            </Text>
          </View>
        ) : (
          skills.map((skill) => {
            const confirming = confirmDeleteId === skill.id;
            const disabled = skill.disabledAt !== null;
            return (
              <View
                key={skill.id}
                style={[styles.skillCard, disabled && styles.skillCardDisabled]}
              >
                <TouchableOpacity
                  style={styles.skillCardBody}
                  onPress={() => openEditor(skill)}
                  activeOpacity={0.75}
                >
                  <View style={styles.skillNameRow}>
                    <Text style={[styles.skillName, disabled && styles.skillNameDisabled]}>
                      {skill.name}
                    </Text>
                    {skill.builtIn ? <Text style={styles.builtInBadge}>系统内置</Text> : null}
                    {disabled ? <Text style={styles.disabledBadge}>已禁用</Text> : null}
                  </View>
                  <Text style={styles.skillDesc} numberOfLines={2}>{skill.description}</Text>
                  <Text style={styles.skillTime}>更新于 {formatTime(skill.updatedAt)}</Text>
                </TouchableOpacity>
                <View style={styles.divider} />
                <View style={styles.skillActions}>
                  <TouchableOpacity
                    style={confirming ? styles.deleteConfirmButton : styles.actionButton}
                    onPress={() => confirmDelete(skill.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={confirming ? styles.deleteConfirmText : styles.deleteButtonText}>
                      {confirming ? '再次点击确认删除' : '删除'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => {
                      setConfirmDeleteId(null);
                      setSkillDisabled(skill.id, !disabled);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.disableButtonText}>
                      {disabled ? '启用' : '禁用'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        <Text style={styles.tipText}>
          经验存储于应用文档目录 skills/ 下（SKILL.md 格式）。所有经验均可编辑、重命名、启用、禁用或删除；删除需要再次点击确认。
        </Text>
      </ScrollView>
    </View>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  flex: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerBack: {
    fontSize: 15,
    color: '#059669',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2329',
    letterSpacing: -0.3,
  },
  headerSave: {
    fontSize: 15,
    color: '#059669',
    fontWeight: '600',
  },

  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 10,
  },
  editorContent: {
    flexGrow: 1,
    paddingBottom: 96,
  },

  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 20,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2329',
  },
  emptyText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 20,
  },

  skillCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  skillCardBody: {
    padding: 16,
    gap: 6,
  },
  skillName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2329',
  },
  skillDesc: {
    fontSize: 13,
    color: '#3C4048',
    lineHeight: 19,
  },
  skillTime: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F3F5',
    marginHorizontal: 16,
  },
  skillActions: {
    flexDirection: 'row',
  },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  skillCardDisabled: {
    opacity: 0.72,
    backgroundColor: '#FAFBFC',
  },
  skillNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  skillNameDisabled: {
    color: '#9CA3AF',
  },
  disabledBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9CA3AF',
    backgroundColor: '#F1F3F5',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  builtInBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: '#047857',
    backgroundColor: '#D1FAE5',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  disableButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  deleteButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#EF4444',
  },
  deleteConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FDECEC',
  },
  deleteConfirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    paddingHorizontal: 4,
    marginTop: 8,
    marginBottom: 6,
  },
  input: {
    fontSize: 14,
    color: '#3C4048',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bodyInput: {
    fontSize: 13,
    color: '#3C4048',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 220,
    lineHeight: 20,
  },
  fieldHint: {
    fontSize: 11,
    color: '#9CA3AF',
    lineHeight: 16,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  errorText: {
    fontSize: 13,
    color: '#EF4444',
    paddingHorizontal: 4,
    marginTop: 8,
    lineHeight: 19,
  },
  tipText: {
    fontSize: 11,
    color: '#9CA3AF',
    lineHeight: 16,
    paddingHorizontal: 4,
    marginTop: 4,
  },
});
