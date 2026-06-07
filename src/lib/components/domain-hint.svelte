<script lang="ts">
  import { browser } from '$app/environment';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { domainHintSeen$ } from '$lib/data/store';
  import { isOnOldUrl } from '$lib/functions/utils';

  $: if (browser && isOnOldUrl(window) && !$domainHintSeen$) {
    $domainHintSeen$ = true;
    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: {
          title: '旧域名',
          message:
            '您正在使用 ッツ 阅读器的旧域名 - 建议切换到 https://reader.ttsu.app 以避免问题并确保完整功能'
        },
        disableCloseOnClick: true
      }
    ]);
  }
</script>
