/**
 * TaskBoard.tsx - 5-column horizontal kanban board for worktree tasks.
 *
 * Renders Backlog, Planning, Running, Review, and Done columns in a
 * horizontally scrollable view. Each column is a vertical FlatList
 * of TaskCard components filtered by status.
 *
 * Status changes are handled via TaskCard long-press ActionSheet
 * (the "Move to..." actions). A FAB in the bottom-right opens
 * the CreateTaskSheet.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import type { WorktreeTask, TaskStatus } from '@/types/api';
import { TaskCard } from './TaskCard';
import { CreateTaskSheet } from './CreateTaskSheet';

/** Column configuration with status key and display label */
interface ColumnConfig {
  status: TaskStatus;
  label: string;
  colorKey: string;
}

/** The 5 kanban columns with their Catppuccin accent color keys */
const COLUMNS: ColumnConfig[] = [
  { status: 'backlog', label: 'Backlog', colorKey: 'overlay0' },
  { status: 'planning', label: 'Planning', colorKey: 'blue' },
  { status: 'running', label: 'Running', colorKey: 'green' },
  { status: 'review', label: 'Review', colorKey: 'yellow' },
  { status: 'done', label: 'Done', colorKey: 'green' },
];

/** Width of each kanban column in pixels */
const COLUMN_WIDTH = 280;
/** Horizontal gap between columns */
const COLUMN_GAP = 12;

interface TaskBoardProps {
  /** All tasks to distribute across columns */
  tasks: WorktreeTask[];
}

/**
 * TaskBoard - Horizontal 5-column kanban board.
 *
 * Columns scroll horizontally; cards within each column scroll vertically.
 * FAB at bottom-right opens the create task sheet.
 *
 * @param props.tasks - Full list of worktree tasks
 */
export function TaskBoard({ tasks }: TaskBoardProps) {
  const { theme } = useTheme();
  const [createVisible, setCreateVisible] = useState(false);

  /** Group tasks by status for each column */
  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, WorktreeTask[]> = {
      backlog: [],
      planning: [],
      running: [],
      review: [],
      done: [],
    };
    for (const task of tasks) {
      if (grouped[task.status]) {
        grouped[task.status].push(task);
      }
    }
    return grouped;
  }, [tasks]);

  /** Render a single task card in a column */
  const renderCard = useCallback(
    ({ item }: { item: WorktreeTask }) => <TaskCard task={item} />,
    []
  );

  /** Stable key extractor */
  const keyExtractor = useCallback((item: WorktreeTask) => item.id, []);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {COLUMNS.map((col) => {
          const colorKey = col.colorKey as keyof typeof theme.colors;
          const columnColor = theme.colors[colorKey] || theme.colors.overlay0;
          const columnTasks = tasksByStatus[col.status];

          return (
            <View
              key={col.status}
              style={[
                styles.column,
                { backgroundColor: theme.colors.bgSecondary },
              ]}
            >
              {/* Column header with colored accent bar */}
              <View style={styles.columnHeader}>
                <View
                  style={[styles.colorBar, { backgroundColor: columnColor }]}
                />
                <Text
                  style={[
                    styles.columnTitle,
                    {
                      color: theme.colors.textPrimary,
                      fontFamily: fonts.sans.semibold,
                    },
                  ]}
                >
                  {col.label}
                </Text>
                <Text
                  style={[
                    styles.columnCount,
                    {
                      color: theme.colors.textSecondary,
                      fontFamily: fonts.sans.regular,
                    },
                  ]}
                >
                  {columnTasks.length}
                </Text>
              </View>

              {/* Task cards list */}
              <FlatList
                data={columnTasks}
                renderItem={renderCard}
                keyExtractor={keyExtractor}
                contentContainerStyle={styles.cardList}
                showsVerticalScrollIndicator={false}
              />
            </View>
          );
        })}
      </ScrollView>

      {/* Floating action button to create task */}
      <Pressable
        onPress={() => setCreateVisible(true)}
        style={[styles.fab, { backgroundColor: theme.colors.accent }]}
      >
        <Ionicons name="add" size={28} color={theme.colors.base} />
      </Pressable>

      <CreateTaskSheet
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 80,
    gap: COLUMN_GAP,
  },
  column: {
    width: COLUMN_WIDTH,
    borderRadius: 12,
    overflow: 'hidden',
    maxHeight: '100%',
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  colorBar: {
    width: 4,
    height: 18,
    borderRadius: 2,
  },
  columnTitle: {
    fontSize: 14,
    flex: 1,
  },
  columnCount: {
    fontSize: 13,
  },
  cardList: {
    padding: 8,
    paddingTop: 0,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
