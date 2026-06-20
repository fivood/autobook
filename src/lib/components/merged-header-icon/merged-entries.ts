/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  faBookmark,
  faBug,
  faChartLine,
  faClockRotateLeft,
  faCloudArrowDown,
  faCog,
  faFileArrowUp,
  faFileZipper,
  faFolderPlus,
  faHashtag,
  faImages,
  faSignOutAlt,
  faTriangleExclamation
} from '@fortawesome/free-solid-svg-icons';

export const mergeEntries = {
  MANAGE: { routeId: '/manage', label: '书库', icon: faSignOutAlt, title: '返回书库' },
  SETTINGS: {
    routeId: '/settings',
    label: '设置',
    icon: faCog,
    title: '阅读器设置'
  },
  STATISTICS: {
    routeId: '/statistics',
    label: '统计',
    icon: faChartLine,
    title: '阅读统计'
  },
  NOTEBOOK: {
    routeId: '/notebook',
    label: '笔记本',
    icon: faBookmark,
    title: '高亮笔记本（跨书）'
  },
  JUMP_TO_POSITION: {
    routeId: '',
    label: '跳转',
    icon: faHashtag,
    title: '跳转到进度（百分比）'
  },
  READER_IMAGE_GALLERY: {
    routeId: '',
    label: '图片',
    icon: faImages,
    title: '打开图片库'
  },
  DOMAIN_HINT: {
    routeId: '',
    label: '域名提示',
    icon: faTriangleExclamation,
    title: '正在使用旧域名'
  },
  BUG_REPORT: { routeId: '', label: '问题反馈', icon: faBug, title: '报告问题' },
  FOLDER_IMPORT: {
    routeId: '',
    label: '导入文件夹',
    icon: faFolderPlus,
    title: '从文件夹导入'
  },
  FILE_IMPORT: { routeId: '', label: '导入文件', icon: faFileArrowUp, title: '导入书籍文件' },
  BACKUP_IMPORT: { routeId: '', label: '导入备份', icon: faFileZipper, title: '从备份导入' },
  CHECK_UPDATE: {
    routeId: '',
    label: '检查更新',
    icon: faCloudArrowDown,
    title: '检查桌面端更新'
  },
  CHANGELOG: {
    routeId: '/changelog',
    label: '更新历史',
    icon: faClockRotateLeft,
    title: '查看版本更新记录'
  }
};
