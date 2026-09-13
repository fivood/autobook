<script lang="ts">
  /**
   * Version history and the manual update check.
   *
   * Both used to be permanent icons in the library bar — each reached for
   * about once a release — while Settings, where people go looking for "is
   * there a new version", had neither. Split out of settings-content.svelte,
   * which is already far too large to keep growing.
   */
  import Ripple from '$lib/components/ripple.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSectionHeader from '$lib/components/settings/settings-section-header.svelte';
  import { isTauri, pagePath } from '$lib/data/env';
  import { manualCheckUpdate } from '$lib/functions/updater/manual-check-update';
  import { t } from '$lib/i18n';

  let checking = false;

  async function check() {
    if (checking) return;
    checking = true;
    try {
      await manualCheckUpdate();
    } finally {
      checking = false;
    }
  }
</script>

<SettingsSectionHeader title={$t('settings.section.updates')} />
<SettingsItemGroup title={$t('menu.changelog.label')}>
  <a class="settings-btn m-1" href="{pagePath}/changelog">
    {$t('menu.changelog.title')}
    <Ripple />
  </a>
</SettingsItemGroup>
{#if isTauri()}
  <SettingsItemGroup title={$t('menu.checkUpdate.label')}>
    <button class="settings-btn m-1" disabled={checking} on:click={check}>
      {$t('menu.checkUpdate.title')}
      <Ripple />
    </button>
  </SettingsItemGroup>
{/if}
