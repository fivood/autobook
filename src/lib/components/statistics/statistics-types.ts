/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import { Subject } from 'rxjs';
import { writableSubject } from '$lib/functions/svelte/store';

export interface StatisticsDateChange {
  dateString: string;
  isStartDate: boolean;
}

export interface StatisticsDataSource {
  key: keyof BookStatistic;
  labelKey: string;
}

export interface StatisticsTitleFilterItem {
  title: string;
  isSelected: boolean;
}

export interface BookStatistic extends BooksDbStatistic {
  id: string;
  averageReadingTime: number;
  averageWeightedReadingTime: number;
  averageCharactersRead: number;
  averageWeightedCharactersRead: number;
  averageReadingSpeed: number;
  averageWeightedReadingSpeed: number;
}

export enum StatisticsTab {
  MAIN = '主视图',
  BOOKS = '书籍',
  AUTHORS = '作者',
  SESSIONS = '会话',
  SUMMARY = '汇总',
  YEAR = '年度',
  HIGHLIGHTS = '高亮'
}

export enum StatisticsRangeTemplate {
  TODAY = '今天',
  WEEK = '本周',
  MONTH = '本月',
  YEAR = '今年',
  ALL = '全部',
  CUSTOM = '自定义'
}

export enum StatisticsReadingDataAggregationMode {
  NONE = '无',
  DATE = '日期',
  TITLE = '标题'
}

// The enum values above are persisted in localStorage, so they stay as they
// are and only these keys are translated.
export const statisticsRangeTemplateLabelKey: Record<StatisticsRangeTemplate, string> = {
  [StatisticsRangeTemplate.TODAY]: 'stats.period.today',
  [StatisticsRangeTemplate.WEEK]: 'stats.period.week',
  [StatisticsRangeTemplate.MONTH]: 'stats.period.month',
  [StatisticsRangeTemplate.YEAR]: 'stats.period.year',
  [StatisticsRangeTemplate.ALL]: 'stats.period.all',
  [StatisticsRangeTemplate.CUSTOM]: 'stats.period.custom'
};

export const statisticsAggregationModeLabelKey: Record<StatisticsReadingDataAggregationMode, string> = {
  [StatisticsReadingDataAggregationMode.NONE]: 'stats.agg.none',
  [StatisticsReadingDataAggregationMode.DATE]: 'stats.agg.date',
  [StatisticsReadingDataAggregationMode.TITLE]: 'stats.agg.title'
};

export const statisticsRangeTemplates = [
  StatisticsRangeTemplate.TODAY,
  StatisticsRangeTemplate.WEEK,
  StatisticsRangeTemplate.MONTH,
  StatisticsRangeTemplate.YEAR,
  StatisticsRangeTemplate.ALL,
  StatisticsRangeTemplate.CUSTOM
];

export const readingTimeDataSources: StatisticsDataSource[] = [
  { key: 'readingTime', labelKey: 'stats.source.readingTime' },
  { key: 'averageReadingTime', labelKey: 'stats.source.averageReadingTime' },
  { key: 'averageWeightedReadingTime', labelKey: 'stats.source.averageWeightedReadingTime' }
];

export const charactersDataSources: StatisticsDataSource[] = [
  { key: 'charactersRead', labelKey: 'stats.source.charactersRead' },
  { key: 'averageCharactersRead', labelKey: 'stats.source.averageCharactersRead' },
  { key: 'averageWeightedCharactersRead', labelKey: 'stats.source.averageWeightedCharactersRead' }
];

export const readingSpeedDataSources: StatisticsDataSource[] = [
  { key: 'lastReadingSpeed', labelKey: 'stats.source.lastReadingSpeed' },
  { key: 'minReadingSpeed', labelKey: 'stats.source.minReadingSpeed' },
  { key: 'altMinReadingSpeed', labelKey: 'stats.source.altMinReadingSpeed' },
  { key: 'maxReadingSpeed', labelKey: 'stats.source.maxReadingSpeed' }
];

export const exportStatisticsData$ = new Subject<boolean>();

export const deleteStatisticsData$ = new Subject<boolean>();

export const setStatisticsDatesToAllTime$ = new Subject<void>();

export const openManualStatisticsEntry$ = new Subject<void>();

export const exportYearReport$ = new Subject<void>();

export interface ManualStatisticEntry {
  title: string;
  dateKey: string;
  readingTimeSeconds: number;
  charactersRead: number;
  markCompleted: boolean;
  conflictStrategy: 'append' | 'overwrite';
}

export const statisticsActionInProgress$ = writableSubject<boolean>(false);

export const statisticsTitleFilterEnabled$ = writableSubject<boolean>(false);

export const statisticsTitleFilterIsOpen$ = writableSubject<boolean>(false);

export const preFilteredTitlesForStatistics$ = writableSubject<Set<string>>(new Set());

export const statisticsDataAggregrationModes = [
  StatisticsReadingDataAggregationMode.NONE,
  StatisticsReadingDataAggregationMode.DATE,
  StatisticsReadingDataAggregationMode.TITLE
];
