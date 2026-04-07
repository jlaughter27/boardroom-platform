// Widget types — Dynamic dashboard layout system

export type WidgetType =
  | 'goal_hierarchy'
  | 'calendar_strip'
  | 'proactive_questions'
  | 'weekly_memo'
  | 'cortex_insights'
  | 'recent_decisions'
  | 'outcome_reviews'
  | 'cognitive_load'
  | 'quick_take'
  | 'relationship_map';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  position: number;
  size: 'small' | 'medium' | 'large' | 'full';
  visible: boolean;
  settings: Record<string, unknown>;
}

export interface DashboardLayout {
  userId: string;
  widgets: WidgetConfig[];
  updatedAt: Date;
}

export const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'w1', type: 'cognitive_load', position: 0, size: 'full', visible: true, settings: {} },
  { id: 'w2', type: 'proactive_questions', position: 1, size: 'full', visible: true, settings: {} },
  { id: 'w3', type: 'outcome_reviews', position: 2, size: 'full', visible: true, settings: {} },
  { id: 'w4', type: 'calendar_strip', position: 3, size: 'full', visible: true, settings: {} },
  { id: 'w5', type: 'weekly_memo', position: 4, size: 'medium', visible: true, settings: {} },
  { id: 'w6', type: 'cortex_insights', position: 5, size: 'medium', visible: true, settings: {} },
  { id: 'w7', type: 'goal_hierarchy', position: 6, size: 'full', visible: true, settings: {} },
];

export const WIDGET_LABELS: Record<WidgetType, string> = {
  goal_hierarchy: 'Goals / Projects / Tasks',
  calendar_strip: 'Calendar Strip',
  proactive_questions: 'Proactive Questions',
  weekly_memo: 'Weekly Memo',
  cortex_insights: 'Cortex Insights',
  recent_decisions: 'Recent Decisions',
  outcome_reviews: 'Outcome Reviews',
  cognitive_load: 'Cognitive Load',
  quick_take: 'Quick Take',
  relationship_map: 'Relationship Map',
};
