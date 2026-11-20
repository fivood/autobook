/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, AutoBook Authors
 * All rights reserved.
 */

/**
 * The OS-level menus: the macOS menu bar, and the tray / menu-bar icon's
 * labels on every platform. Tauri only — the caller checks.
 *
 * Until 1.61 macOS showed Tauri's stock menu (English File / Edit / View /
 * Window / Help with nothing of the app's own in it) and the tray labels were
 * Chinese literals in Rust, so an English or Japanese UI still got 显示窗口.
 * Both are built here so they go through the same i18n tables and follow a
 * language switch.
 */

import { goto } from '$app/navigation';
import { NAV_DESTINATIONS } from '$lib/components/merged-header-icon/merged-entries';
import { pagePath } from '$lib/data/env';
import { pendingLaunchFiles$, ttsShortcut$, windowAlwaysOnTop$ } from '$lib/data/store';
import { manualCheckUpdate } from '$lib/functions/updater/manual-check-update';
import { locale$, tImmediate as t } from '$lib/i18n';

// WKWebView reports "MacIntel" on both Intel and Apple silicon.
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

const ISSUES_URL = 'https://github.com/fivood/autobook/issues';
const BOOK_EXTENSIONS = ['epub', 'txt', 'md', 'markdown', 'htmlz', 'mobi', 'azw', 'azw3', 'pdf', 'cbz', 'cbr', 'cb7', 'cbt'];

/** `ctrl+alt+p` → `⌃⌥P` on macOS, `Ctrl+Alt+P` elsewhere. */
export function formatShortcut(accelerator: string, mac = isMac): string {
  const macKeys: Record<string, string> = { ctrl: '⌃', control: '⌃', alt: '⌥', option: '⌥', shift: '⇧', cmd: '⌘', command: '⌘', super: '⌘', meta: '⌘' };
  const parts = accelerator.split('+').map((p) => p.trim()).filter(Boolean);
  if (mac) return parts.map((p) => macKeys[p.toLowerCase()] ?? p.toUpperCase()).join('');
  return parts.map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1).toLowerCase())).join('+');
}

/** Pick books with the native panel and import them the way a file opened
 * from Finder is imported. A hidden <input type=file>.click() from a menu
 * event is not a user gesture, which WebKit may refuse. */
async function importBooks() {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: true,
    filters: [{ name: t('macMenu.import'), extensions: BOOK_EXTENSIONS }]
  });
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  if (!paths.length) return;
  pendingLaunchFiles$.next([...pendingLaunchFiles$.getValue(), ...paths]);
  goto(`${pagePath}/manage`);
}

async function openIssues() {
  const { open } = await import('@tauri-apps/plugin-shell');
  await open(ISSUES_URL);
}

async function buildMacMenu() {
  const { Menu, Submenu, MenuItem, PredefinedMenuItem, CheckMenuItem } = await import('@tauri-apps/api/menu');
  const sep = () => PredefinedMenuItem.new({ item: 'Separator' });
  const go = (path: string) => () => goto(`${pagePath}${path}`);

  const onTop = await CheckMenuItem.new({
    text: t('settings.item.alwaysOnTop'),
    checked: windowAlwaysOnTop$.getValue(),
    action: () => windowAlwaysOnTop$.next(!windowAlwaysOnTop$.getValue())
  });

  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: 'AutoBook',
        items: [
          await MenuItem.new({ text: t('macMenu.about'), action: go('/settings?tab=About') }),
          await MenuItem.new({ text: t('macMenu.checkUpdate'), action: () => manualCheckUpdate() }),
          await sep(),
          await MenuItem.new({ text: t('macMenu.settings'), accelerator: 'CmdOrCtrl+,', action: go('/settings') }),
          await sep(),
          await PredefinedMenuItem.new({ item: 'Services', text: t('macMenu.services') }),
          await sep(),
          await PredefinedMenuItem.new({ item: 'Hide', text: t('macMenu.hide') }),
          await PredefinedMenuItem.new({ item: 'HideOthers', text: t('macMenu.hideOthers') }),
          await PredefinedMenuItem.new({ item: 'ShowAll', text: t('macMenu.showAll') }),
          await sep(),
          await PredefinedMenuItem.new({ item: 'Quit', text: t('macMenu.quit') })
        ]
      }),
      await Submenu.new({
        text: t('macMenu.file'),
        items: [
          await MenuItem.new({ text: t('macMenu.import'), accelerator: 'CmdOrCtrl+O', action: importBooks }),
          await sep(),
          await PredefinedMenuItem.new({ item: 'CloseWindow', text: t('macMenu.closeWindow') })
        ]
      }),
      // Keep this one: WKWebView only gets ⌘C / ⌘V / ⌘Z in text fields from
      // an Edit menu that carries the standard items.
      await Submenu.new({
        text: t('macMenu.edit'),
        items: [
          await PredefinedMenuItem.new({ item: 'Undo', text: t('macMenu.undo') }),
          await PredefinedMenuItem.new({ item: 'Redo', text: t('macMenu.redo') }),
          await sep(),
          await PredefinedMenuItem.new({ item: 'Cut', text: t('macMenu.cut') }),
          await PredefinedMenuItem.new({ item: 'Copy', text: t('macMenu.copy') }),
          await PredefinedMenuItem.new({ item: 'Paste', text: t('macMenu.paste') }),
          await PredefinedMenuItem.new({ item: 'SelectAll', text: t('macMenu.selectAll') })
        ]
      }),
      await Submenu.new({
        text: t('macMenu.view'),
        items: [
          // Same five places, same order as the in-app nav strip.
          ...(await Promise.all(
            NAV_DESTINATIONS.map((d, i) =>
              MenuItem.new({ text: t(d.labelKey), accelerator: `CmdOrCtrl+${i + 1}`, action: go(d.routeId) })
            )
          )),
          await sep(),
          await PredefinedMenuItem.new({ item: 'Fullscreen', text: t('macMenu.fullscreen') })
        ]
      }),
      await Submenu.new({
        text: t('macMenu.window'),
        items: [
          await PredefinedMenuItem.new({ item: 'Minimize', text: t('macMenu.minimize') }),
          await PredefinedMenuItem.new({ item: 'Maximize', text: t('macMenu.zoom') }),
          await sep(),
          onTop
        ]
      }),
      await Submenu.new({
        text: t('macMenu.help'),
        items: [
          await MenuItem.new({ text: t('menu.changelog.label'), action: go('/changelog') }),
          await MenuItem.new({ text: t('macMenu.feedback'), action: openIssues })
        ]
      })
    ]
  });
  await menu.setAsAppMenu();
  return onTop;
}

export function setupNativeMenus() {
  const updateTray = async () => {
    const shortcut = ttsShortcut$.getValue();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_tray_labels', {
        show: t('tray.show'),
        tts: shortcut
          ? t('tray.ttsWithKey', { key: formatShortcut(shortcut) })
          : t('tray.tts'),
        reset: t('tray.reset'),
        quit: t('tray.quit')
      });
    } catch (err) {
      // Labels stay in the build-time language; the tray itself still works.
      console.warn('[tray] labels not updated:', err);
    }
  };
  // tImmediate reads the current locale, so either change just re-labels.
  locale$.subscribe(updateTray);
  ttsShortcut$.subscribe(updateTray);

  if (!isMac) return;
  let onTopItem: Awaited<ReturnType<typeof buildMacMenu>> | undefined;
  locale$.subscribe(async () => {
    try {
      onTopItem = await buildMacMenu();
    } catch (err) {
      // Tauri's stock menu stays: English, but Edit / Quit still work.
      console.warn('[menu] app menu not built:', err);
    }
  });
  windowAlwaysOnTop$.subscribe((on) => {
    onTopItem?.setChecked(on).catch(() => {
      // A stale item from before a rebuild; the new one reads the store.
    });
  });
}
