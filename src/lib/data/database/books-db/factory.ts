/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDb from './versions/books-db';
import { openDB } from 'idb';
import upgradeBooksDbFromV2 from './versions/v2/upgrade';

export function createBooksDb(name = 'books') {
  return openDB<BooksDb>(name, 10, {
    async upgrade(oldDb, oldVersion, newVersion, transaction) {
      switch (oldVersion) {
        case 0: {
          const dataStore = oldDb.createObjectStore('data', {
            keyPath: 'id',
            autoIncrement: true
          });
          dataStore.createIndex('title', 'title');

          oldDb.createObjectStore('bookmark', {
            keyPath: 'dataId'
          });

          oldDb.createObjectStore('lastItem');

          oldDb.createObjectStore('storageSource', {
            keyPath: 'name'
          });

          const statisticsStore = oldDb.createObjectStore('statistic', {
            keyPath: ['title', 'dateKey']
          });

          statisticsStore.createIndex('dateKey', 'dateKey');
          statisticsStore.createIndex('completedBook', ['completedBook', 'title']);

          const readingGoalsStore = oldDb.createObjectStore('readingGoal', {
            keyPath: 'goalStartDate'
          });

          readingGoalsStore.createIndex('goalEndDate', 'goalEndDate');

          oldDb.createObjectStore('lastModified', {
            keyPath: ['title', 'dataType']
          });

          oldDb.createObjectStore('audioBook', { keyPath: 'title' });

          oldDb.createObjectStore('subtitle', { keyPath: 'title' });

          oldDb.createObjectStore('handle', { keyPath: ['title', 'dataType'] });

          // v7: library folders.
          const freshHighlightStore = oldDb.createObjectStore('highlight', {
            keyPath: 'id',
            autoIncrement: true
          });
          freshHighlightStore.createIndex('dataId', 'dataId');
          freshHighlightStore.createIndex('dataIdStartOffset', ['dataId', 'startOffset']);

          const freshHighlightFolderStore = oldDb.createObjectStore('highlightFolder', {
            keyPath: 'id',
            autoIncrement: true
          });
          freshHighlightFolderStore.createIndex('sortOrder', 'sortOrder');

          const freshFolderStore = oldDb.createObjectStore('folder', {
            keyPath: 'id',
            autoIncrement: true
          });
          freshFolderStore.createIndex('sortOrder', 'sortOrder');
          const freshBookFolderStore = oldDb.createObjectStore('bookFolder', {
            keyPath: ['bookId', 'folderId']
          });
          freshBookFolderStore.createIndex('bookId', 'bookId');
          freshBookFolderStore.createIndex('folderId', 'folderId');

          // v10: reading sessions.
          const freshSessionStore = oldDb.createObjectStore('session', {
            keyPath: 'id',
            autoIncrement: true
          });
          freshSessionStore.createIndex('dateKey', 'dateKey');
          freshSessionStore.createIndex('title', 'title');
          freshSessionStore.createIndex('startTs', 'startTs');

          break;
        }
        case 2: {
          await upgradeBooksDbFromV2(oldDb, oldVersion, newVersion, transaction);
          break;
        }
        case 3: {
          oldDb.createObjectStore('storageSource', {
            keyPath: 'name'
          });
          break;
        }
        case 4: {
          const statisticsStore = oldDb.createObjectStore('statistic', {
            keyPath: ['title', 'dateKey']
          });

          statisticsStore.createIndex('dateKey', 'dateKey');
          statisticsStore.createIndex('completedBook', ['completedBook', 'title']);

          const readingGoalsStore = oldDb.createObjectStore('readingGoal', {
            keyPath: 'goalStartDate'
          });

          readingGoalsStore.createIndex('goalEndDate', 'goalEndDate');

          oldDb.createObjectStore('lastModified', {
            keyPath: ['title', 'dataType']
          });

          break;
        }
        case 5: {
          if (!oldDb.objectStoreNames.contains('audioBook')) {
            oldDb.createObjectStore('audioBook', { keyPath: 'title' });
          }

          if (!oldDb.objectStoreNames.contains('subtitle')) {
            oldDb.createObjectStore('subtitle', { keyPath: 'title' });
          }

          if (!oldDb.objectStoreNames.contains('handle')) {
            oldDb.createObjectStore('handle', { keyPath: ['title', 'dataType'] });
          }

          // Fall through to v6 → v7 upgrade.
        }
        case 6: {
          if (!oldDb.objectStoreNames.contains('folder')) {
            const folderStore = oldDb.createObjectStore('folder', {
              keyPath: 'id',
              autoIncrement: true
            });
            folderStore.createIndex('sortOrder', 'sortOrder');
          }

          if (!oldDb.objectStoreNames.contains('bookFolder')) {
            const bookFolderStore = oldDb.createObjectStore('bookFolder', {
              keyPath: ['bookId', 'folderId']
            });
            bookFolderStore.createIndex('bookId', 'bookId');
            bookFolderStore.createIndex('folderId', 'folderId');
          }

          // Fall through to v7 → v8 upgrade.
        }
        case 7: {
          if (!oldDb.objectStoreNames.contains('highlight')) {
            const highlightStore = oldDb.createObjectStore('highlight', {
              keyPath: 'id',
              autoIncrement: true
            });
            highlightStore.createIndex('dataId', 'dataId');
            highlightStore.createIndex('dataIdStartOffset', ['dataId', 'startOffset']);
          }
          // Fall through to v8 → v9 upgrade.
        }
        case 8: {
          if (!oldDb.objectStoreNames.contains('highlightFolder')) {
            const highlightFolderStore = oldDb.createObjectStore('highlightFolder', {
              keyPath: 'id',
              autoIncrement: true
            });
            highlightFolderStore.createIndex('sortOrder', 'sortOrder');
          }
          // fall through to v9 → v10 upgrade.
        }
        case 9: {
          if (!oldDb.objectStoreNames.contains('session')) {
            const sessionStore = oldDb.createObjectStore('session', {
              keyPath: 'id',
              autoIncrement: true
            });
            sessionStore.createIndex('dateKey', 'dateKey');
            sessionStore.createIndex('title', 'title');
            sessionStore.createIndex('startTs', 'startTs');
          }
          break;
        }
      }
    }
  });
}
