<script lang="ts">
  import Fa from 'svelte-fa';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { t } from '$lib/i18n';
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{$t('manage.loading')}</svelte:fragment>
  <svelte:fragment slot="content">
    <div class="flex items-center gap-3">
      <Fa icon={faSpinner} spin class="text-xl" />
      <p>{$t('manage.loadingHint')}</p>
    </div>
  </svelte:fragment>
  <svelte:fragment slot="footer" />
</DialogTemplate>
