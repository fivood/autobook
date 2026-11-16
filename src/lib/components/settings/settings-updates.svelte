<script lang="ts">
  /**
   * Version history and the manual update check — the 关于 tab.
   *
   * Both used to be permanent icons in the library bar — each reached for
   * about once a release — while Settings, where people go looking for "is
   * there a new version", had neither. Split out of settings-content.svelte,
   * which is already far too large to keep growing. It then sat at the very
   * bottom of 数据, under diagnostics, where nobody looking for "which version
   * am I on" would scroll to; the version itself was shown nowhere.
   */
  import Ripple from '$lib/components/ripple.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSectionHeader from '$lib/components/settings/settings-section-header.svelte';
  import { isTauri, pagePath } from '$lib/data/env';
  import { checkingUpdate$, manualCheckUpdate } from '$lib/functions/updater/manual-check-update';
  import { t } from '$lib/i18n';

  const appVersion = __APP_VERSION__;
</script>

<SettingsSectionHeader title={$t('settings.section.updates')} />
<SettingsItemGroup title={$t('settings.currentVersion')}>
  <p class="m-1 text-heading font-medium">v{appVersion}</p>
</SettingsItemGroup>
{#if isTauri()}
  <SettingsItemGroup title={$t('menu.checkUpdate.label')}>
    <button class="settings-btn m-1" disabled={$checkingUpdate$} on:click={manualCheckUpdate}>
      {$checkingUpdate$ ? $t('update.checking') : $t('menu.checkUpdate.title')}
      <Ripple />
    </button>
  </SettingsItemGroup>
{/if}
<SettingsItemGroup title={$t('menu.changelog.label')}>
  <a class="settings-btn m-1" href="{pagePath}/changelog">
    {$t('menu.changelog.title')}
    <Ripple />
  </a>
</SettingsItemGroup>
