/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const heatmapDayElementSize = 15;

export const heatmapDayMargins = 20;

export const heatmapGridGapValue = 1;

export const heatmapMinValueColor = 'c6e48b';

export const heatmapMaxValueColor = '196127';

export const daysOfWeek = [
  '周日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六'
];

export const daysOfWeekShort = ['日', '一', '二', '三', '四', '五', '六'];

export const monthLabelList: HeatmapMonthLabel[] = [
  { monthLabel: '1月', heatmapColumn: '' },
  { monthLabel: '2月', heatmapColumn: '' },
  { monthLabel: '3月', heatmapColumn: '' },
  { monthLabel: '4月', heatmapColumn: '' },
  { monthLabel: '5月', heatmapColumn: '' },
  { monthLabel: '6月', heatmapColumn: '' },
  { monthLabel: '7月', heatmapColumn: '' },
  { monthLabel: '8月', heatmapColumn: '' },
  { monthLabel: '9月', heatmapColumn: '' },
  { monthLabel: '10月', heatmapColumn: '' },
  { monthLabel: '11月', heatmapColumn: '' },
  { monthLabel: '12月', heatmapColumn: '' }
];

export enum HeatmapType {
  STATISTICS = 'statistics',
  READING_GOALS = 'readingGoals'
}

export enum HeatmapDataAggregration {
  ALL_TIME = 'allTime',
  YEAR = 'year'
}

export enum HeatmapStreakType {
  NONE = 'none',
  LONGEST = 'longest',
  CURRENT = 'current',
  READING_GOALS_COMPLETED = 'readingGoalsCompleted'
}

export interface HeatmapMonthLabel {
  monthLabel: string;
  heatmapColumn: string;
}

export interface HeatmapStreak {
  startDate: string;
  endDate: string;
  duration: number;
}

export interface HeatmapColorRange {
  limit: number;
  color: string;
}

export interface HeatmapData {
  streaks: HeatmapStreak[];
  longestStreaks: HeatmapStreak[];
  currentStreak: HeatmapStreak;
}

export interface HeatmapGlobalDayData {
  readingTime: number;
  charactersRead: number;
  titles: Set<string>;
}

export interface HeatmapDayData {
  dateString: string;
  isCurrentYear: boolean;
  heatmapRow: number;
  heatmapColumn: number;
  color: string;
  dayDetails: string[];
}

export interface StatisticsHeatmapData extends HeatmapData {
  daysRead: string;
  colorRanges: HeatmapColorRange[];
}

export interface StatisticsHeatmapDayData
  extends HeatmapDayData,
    Omit<HeatmapGlobalDayData, 'charactersRead' | 'titles'> {}

export interface ReadingGoalHeatmapGlobalDayData extends HeatmapGlobalDayData {
  readingGoalStartDate: string;
  readingGoalEndDate: string;
  timeGoal: number;
  characterGoal: number;
  closedEarly: boolean;
  readingTimePercentage: number;
  normalizedReadingTimePercentage: number;
  charactersReadPercentage: number;
  normalizedCharactersReadPercentage: number;
  readingGoalCompletedPercentage: number;
  normalizedReadingGoalCompletedPercentage: number;
}

export interface ReadingGoalsHeatmapData extends HeatmapData {
  completedReadingGoals: string;
}
