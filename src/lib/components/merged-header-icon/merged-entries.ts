/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// `label` doubles as the dispatch identity across the header components
// (`switch (detail)`, `find((it) => it.label === target)`). Translating it
// would break every callback. Instead each entry carries sidecar
// `labelKey` / `titleKey` fields that MergedHeaderIcon feeds through
// `$t()` at render time — untranslated identity is preserved on the
// wire, only the visible strings switch locale.
import {
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
  faLanguage,
  faLightbulb,
  faSignOutAlt,
  faTriangleExclamation
} from '@fortawesome/free-solid-svg-icons';

export const mergeEntries = {
  MANAGE: {
    routeId: '/manage',
    label: '书库',
    labelKey: 'menu.manage.label',
    icon: faSignOutAlt,
    title: '返回书库',
    titleKey: 'menu.manage.title'
  },
  SETTINGS: {
    routeId: '/settings',
    label: '设置',
    labelKey: 'menu.settings.label',
    icon: faCog,
    title: '阅读器设置',
    titleKey: 'menu.settings.title'
  },
  STATISTICS: {
    routeId: '/statistics',
    label: '统计',
    labelKey: 'menu.statistics.label',
    icon: faChartLine,
    title: '阅读统计',
    titleKey: 'menu.statistics.title'
  },
  NOTEBOOK: {
    routeId: '/notebook',
    label: '笔记本',
    labelKey: 'menu.notebook.label',
    icon: faLightbulb,
    title: '高亮笔记本（跨书）',
    titleKey: 'menu.notebook.title'
  },
  TRANSLATE: {
    routeId: '/translate',
    label: '翻译',
    labelKey: 'menu.translate.label',
    icon: faLanguage,
    title: '打开翻译工作台',
    titleKey: 'menu.translate.title'
  },
  JUMP_TO_POSITION: {
    routeId: '',
    label: '跳转',
    labelKey: 'menu.jump.label',
    icon: faHashtag,
    title: '跳转到进度（百分比）',
    titleKey: 'menu.jump.title'
  },
  READER_IMAGE_GALLERY: {
    routeId: '',
    label: '图片',
    labelKey: 'menu.imageGallery.label',
    icon: faImages,
    title: '打开图片库',
    titleKey: 'menu.imageGallery.title'
  },
  DOMAIN_HINT: {
    routeId: '',
    label: '域名提示',
    labelKey: 'menu.domainHint.label',
    icon: faTriangleExclamation,
    title: '正在使用旧域名',
    titleKey: 'menu.domainHint.title'
  },
  BUG_REPORT: {
    routeId: '',
    label: '问题反馈',
    labelKey: 'menu.bugReport.label',
    icon: faBug,
    title: '报告问题',
    titleKey: 'menu.bugReport.title'
  },
  FOLDER_IMPORT: {
    routeId: '',
    label: '导入文件夹',
    labelKey: 'menu.folderImport.label',
    icon: faFolderPlus,
    title: '从文件夹导入',
    titleKey: 'menu.folderImport.title'
  },
  FILE_IMPORT: {
    routeId: '',
    label: '导入文件',
    labelKey: 'menu.fileImport.label',
    icon: faFileArrowUp,
    title: '导入书籍文件',
    titleKey: 'menu.fileImport.title'
  },
  BACKUP_IMPORT: {
    routeId: '',
    label: '导入备份',
    labelKey: 'menu.backupImport.label',
    icon: faFileZipper,
    title: '从备份导入',
    titleKey: 'menu.backupImport.title'
  },
  CHECK_UPDATE: {
    routeId: '',
    label: '检查更新',
    labelKey: 'menu.checkUpdate.label',
    icon: faCloudArrowDown,
    title: '检查桌面端更新',
    titleKey: 'menu.checkUpdate.title'
  },
  CHANGELOG: {
    routeId: '/changelog',
    label: '更新历史',
    labelKey: 'menu.changelog.label',
    icon: faClockRotateLeft,
    title: '查看版本更新记录',
    titleKey: 'menu.changelog.title'
  }
};
