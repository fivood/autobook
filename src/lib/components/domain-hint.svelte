<script lang="ts">
  import { browser } from '$app/environment';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { domainHintSeen$ } from '$lib/data/store';
  import { isOnOldUrl } from '$lib/functions/utils';
  import { tImmediate } from '$lib/i18n';

  $: if (browser && isOnOldUrl(window) && !$domainHintSeen$) {
    $domainHintSeen$ = true;
    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: {
          title: tImmediate('domainHint.title'),
          message: tImmediate('domainHint.message')
        },
        disableCloseOnClick: true
      }
    ]);
  }
</script>
