/**
 * HistoryScreen — list of past agent sessions.
 *
 * Each row shows:
 *   - The original command (headline)
 *   - Step count + outcome badge (complete / stopped / error)
 *   - Short summary from the agent
 *   - Relative timestamp
 *
 * Sessions are persisted to AsyncStorage (up to 100) and restored on startup.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  LayoutAnimation,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import type {
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';

import {
  type AgentSession,
  type SessionOutcome,
  clearSessions,
  removeSession,
  subscribeSessions,
} from '../../src/store/historyStore';

// Enable LayoutAnimation on Android (required for animated expand/collapse).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type OutcomeFilter = 'all' | SessionOutcome;

export function HistoryScreen() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');

  useEffect(() => subscribeSessions(setSessions), []);

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (outcomeFilter !== 'all') {
      result = result.filter((s) => s.outcome === outcomeFilter);
    }
    const q = searchText.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (s) =>
          s.command.toLowerCase().includes(q) ||
          (s.summary?.toLowerCase().includes(q) ?? false),
      );
    }
    return result;
  }, [sessions, searchText, outcomeFilter]);

  const handleClear = useCallback(() => {
    setSelectedId(null);
    clearSessions();
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const handleDelete = useCallback((id: string) => {
    setSelectedId(null);
    removeSession(id);
  }, []);

  const isFiltered = searchText.trim().length > 0 || outcomeFilter !== 'all';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>历史记录</Text>
        {sessions.length > 0 && (
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.headerClear}>清空</Text>
          </TouchableOpacity>
        )}
      </View>

      {sessions.length > 0 && (
        <View style={styles.filterArea}>
          <TextInput
            style={styles.searchInput}
            placeholder="搜索指令…"
            placeholderTextColor="#9CA3AF"
            value={searchText}
            onChangeText={setSearchText}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          <View style={styles.chips}>
            {(['all', 'complete', 'stopped', 'error'] as OutcomeFilter[]).map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.chip, outcomeFilter === f && styles.chipActive]}
                onPress={() => setOutcomeFilter(f)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, outcomeFilter === f && styles.chipTextActive]}>
                  {f === 'all' ? '全部' : f === 'complete' ? '完成' : f === 'stopped' ? '已停止' : '出错'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {sessions.length === 0 ? (
        <EmptyState />
      ) : filteredSessions.length === 0 ? (
        <NoResultsState isFiltered={isFiltered} />
      ) : (
        <FlatList
          data={filteredSessions}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <SwipeToDeleteRow onDelete={() => handleDelete(item.id)}>
              <SessionRow
                session={item}
                isSelected={selectedId === item.id}
                onSelect={handleSelect}
                onDelete={handleDelete}
              />
            </SwipeToDeleteRow>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            isFiltered ? (
              <Text style={styles.resultCount}>
                {filteredSessions.length} 条结果
              </Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Swipe-to-delete wrapper
// ---------------------------------------------------------------------------

const DELETE_ACTION_WIDTH = 72;
const SNAP_THRESHOLD = 28;

function SwipeToDeleteRow({
  onDelete,
  children,
}: {
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const posX = useRef(new Animated.Value(0)).current;
  const settled = useRef(0);

  const handleGesture = useCallback(
    (e: PanGestureHandlerGestureEvent) => {
      const raw = settled.current + e.nativeEvent.translationX;
      posX.setValue(Math.max(-DELETE_ACTION_WIDTH, Math.min(0, raw)));
    },
    [posX],
  );

  const handleStateChange = useCallback(
    (e: PanGestureHandlerStateChangeEvent) => {
      const { state, translationX } = e.nativeEvent;
      if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
        const current = Math.max(-DELETE_ACTION_WIDTH, Math.min(0, settled.current + translationX));
        const target = current < -SNAP_THRESHOLD ? -DELETE_ACTION_WIDTH : 0;
        settled.current = target;
        Animated.spring(posX, {
          toValue: target,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }).start();
      }
    },
    [posX],
  );

  const handleDeletePress = useCallback(() => {
    Animated.timing(posX, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      settled.current = 0;
      onDelete();
    });
  }, [onDelete, posX]);

  return (
    <View style={styles.swipeWrapper}>
      <View style={styles.deleteActionContainer}>
        <TouchableOpacity
          style={styles.deleteActionButton}
          onPress={handleDeletePress}
          activeOpacity={0.8}
        >
          <Text style={styles.deleteActionLabel}>删除</Text>
        </TouchableOpacity>
      </View>
      <PanGestureHandler
        onGestureEvent={handleGesture}
        onHandlerStateChange={handleStateChange}
        activeOffsetX={[-10, 10]}
        failOffsetY={[-15, 15]}
      >
        <Animated.View style={{ transform: [{ translateX: posX }] }}>
          {children}
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Session row
// ---------------------------------------------------------------------------

interface SessionRowProps {
  session: AgentSession;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function SessionRow({ session, isSelected, onSelect, onDelete }: SessionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasActions = session.actions.length > 0;

  const toggle = useCallback(() => {
    // Tapping a selected row deselects it; rows without steps select directly.
    // Rows with steps collapse/expand their step details on tap.
    if (isSelected || !hasActions) {
      onSelect(session.id);
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  }, [hasActions, isSelected, onSelect, session.id]);

  const handleLongPress = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onSelect(session.id);
  }, [onSelect, session.id]);

  const handleDelete = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onDelete(session.id);
  }, [onDelete, session.id]);

  const handleShare = useCallback(() => {
    Share.share({ message: formatSessionText(session) }).catch(() => {});
  }, [session]);

  const handleCopy = useCallback(() => {
    try {
      // Lazy-require so a missing/incompatible native module never crashes at
      // bundle load; the copy action simply no-ops if the module is absent.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
      // Copy only the original user command, not the whole session transcript.
      Clipboard.setStringAsync(session.command)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {});
    } catch {
      // expo-clipboard not linked — copy unavailable.
    }
  }, [session]);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={toggle}
      onLongPress={handleLongPress}
      style={[styles.row, isSelected && styles.rowSelected]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.command} numberOfLines={2}>{session.command}</Text>
        <View style={styles.topRight}>
          <OutcomeBadge outcome={session.outcome} />
          <TouchableOpacity
            onPress={handleCopy}
            style={styles.copyButton}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            activeOpacity={0.7}
          >
            <Text style={[styles.copyButtonText, copied && styles.copyButtonTextDone]}>
              {copied ? '已复制' : '复制'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {session.summary ? (
        <Text style={styles.summary} numberOfLines={expanded ? undefined : 3}>{session.summary}</Text>
      ) : null}

      <View style={styles.rowMeta}>
        <Text style={styles.metaText}>
          {session.stepCount} {session.stepCount === 1 ? 'step' : 'steps'}
        </Text>
        {session.durationMs !== undefined && (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{formatDuration(session.durationMs)}</Text>
          </>
        )}
        {session.totalTokens !== undefined && session.totalTokens > 0 && (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{formatTokens(session.totalTokens)}</Text>
          </>
        )}
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{formatRelativeTime(session.timestamp)}</Text>
      </View>

      {session.actions.length > 0 && (
        <ActionList actions={session.actions} expanded={expanded} />
      )}

      {isSelected && (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.shareButton]}
            onPress={handleShare}
            activeOpacity={0.8}
          >
            <Text style={styles.shareButtonText}>分享</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={handleDelete}
            activeOpacity={0.8}
          >
            <Text style={styles.deleteButtonText}>删除</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

function OutcomeBadge({ outcome }: { outcome: SessionOutcome }) {
  const colors: Record<SessionOutcome, { bg: string; text: string; label: string }> = {
    complete: { bg: '#0a1f0a', text: '#4ADE80', label: '完成' },
    stopped:  { bg: '#1a1a0a', text: '#FACC15', label: '已终止' },
    error:    { bg: '#1f0a0a', text: '#FF6B6B', label: '出错' },
  };
  const c = colors[outcome];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}

function ActionList({ actions, expanded }: { actions: string[]; expanded: boolean }) {
  const shown = expanded ? actions : [];

  return (
    <View style={styles.actionList}>
      {shown.map((a, i) => (
        <View key={i} style={styles.actionItem}>
          <View style={styles.actionDot} />
          <Text style={styles.actionText} numberOfLines={1}>{a}</Text>
        </View>
      ))}
      {!expanded && (
        <Text style={styles.actionMore}>{actions.length} 个步骤 — 点击展开</Text>
      )}
      {expanded && (
        <Text style={styles.actionMore}>点击收起</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty / no-results states
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>📋</Text>
      <Text style={styles.emptyHeadline}>还没有历史记录</Text>
      <Text style={styles.emptySubtext}>
        执行过任务后，记录会显示在这里。
      </Text>
    </View>
  );
}

function NoResultsState({ isFiltered }: { isFiltered: boolean }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>🔍</Text>
      <Text style={styles.emptyHeadline}>没有结果</Text>
      <Text style={styles.emptySubtext}>
        {isFiltered
          ? '换个关键词或筛选条件试试。'
          : '没有符合当前筛选条件的记录。'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k tokens`;
  return `${tokens} tokens`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const secs  = Math.floor(diff / 1000);
  const mins  = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);

  if (secs < 60)   return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return `${days}d ago`;
}

function formatSessionText(session: AgentSession): string {
  const date = new Date(session.timestamp).toLocaleString();
  const outcomeLine = `${session.outcome.charAt(0).toUpperCase() + session.outcome.slice(1)} · ${session.stepCount} ${session.stepCount === 1 ? 'step' : 'steps'}${session.durationMs !== undefined ? ` · ${formatDuration(session.durationMs)}` : ''}`;
  const actionLines = session.actions.length > 0
    ? '\nActions:\n' + session.actions.map((a) => `• ${a}`).join('\n')
    : '';
  const summaryLine = session.summary ? `\n\n${session.summary}` : '';
  return `豆泡任务记录 — ${date}\n\n指令：${session.command}\n${outcomeLine}${actionLines}${summaryLine}`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 64,
    paddingRight: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2329',
    letterSpacing: -0.3,
  },
  headerClear: {
    fontSize: 14,
    color: '#6B7280',
  },

  // Filter area
  filterArea: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#3C4048',
    fontSize: 14,
  },
  chips: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chipActive: {
    backgroundColor: '#E7F8EF',
    borderColor: '#A7F3D0',
  },
  chipText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#059669',
  },
  resultCount: {
    fontSize: 12,
    color: '#6B7280',
    paddingBottom: 4,
  },

  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },

  // Swipe-to-delete
  swipeWrapper: {
    position: 'relative',
  },
  deleteActionContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: DELETE_ACTION_WIDTH,
    borderRadius: 14,
    overflow: 'hidden',
  },
  deleteActionButton: {
    flex: 1,
    backgroundColor: '#FF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteActionLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  // Session row
  row: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    gap: 8,
  },
  rowSelected: {
    borderColor: '#FF6B6B44',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  shareButton: {
    backgroundColor: '#E7F8EF',
  },
  shareButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#059669',
  },
  deleteButton: {
    backgroundColor: '#FDECEC',
  },
  deleteButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF6B6B',
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  topRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  copyButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  copyButtonText: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  copyButtonTextDone: {
    color: '#059669',
  },
  command: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#3C4048',
    lineHeight: 21,
  },
  summary: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
  },

  // Meta line
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: '#6B7280',
  },
  metaDot: {
    fontSize: 12,
    color: '#333',
  },

  // Outcome badge
  badge: {
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Action list
  actionList: {
    gap: 4,
    marginTop: 4,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#4ADE80',
    flexShrink: 0,
  },
  actionText: {
    fontSize: 12,
    color: '#6B7280',
    flex: 1,
  },
  actionMore: {
    fontSize: 12,
    // Lighter than the surrounding meta text so the expand/collapse hint
    // reads as a secondary affordance; flush-left with the row above it.
    color: '#9CA3AF',
    paddingLeft: 0,
  },

  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 4,
  },
  emptyHeadline: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});
