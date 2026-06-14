/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type BooksDb from './versions/books-db';
import { openDB } from 'idb';
import upgradeBooksDbFromV2 from './versions/v2/upgrade';

export function createBooksDb(name = 'books') {
  return openDB<BooksDb>(name, 7, {
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
          oldDb.createObjectStore('audioBook', { keyPath: 'title' });

          oldDb.createObjectStore('subtitle', { keyPath: 'title' });

          oldDb.createObjectStore('handle', { keyPath: ['title', 'dataType'] });

          // Fall through to v6 → v7 upgrade.
        }
        // eslint-disable-next-line no-fallthrough
        case 6: {
          const folderStore = oldDb.createObjectStore('folder', {
            keyPath: 'id',
            autoIncrement: true
          });
          folderStore.createIndex('sortOrder', 'sortOrder');

          const bookFolderStore = oldDb.createObjectStore('bookFolder', {
            keyPath: ['bookId', 'folderId']
          });
          bookFolderStore.createIndex('bookId', 'bookId');
          bookFolderStore.createIndex('folderId', 'folderId');

          break;
        }
      }
    }
  });
}
