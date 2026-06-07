<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import Ripple from '$lib/components/ripple.svelte';
  import { buttonClasses } from '$lib/css-classes';
  import { hideExternalReadHint$ } from '$lib/data/store';
  import { createEventDispatcher } from 'svelte';

  export let resolver: (arg0: string) => void;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  function closeDialog(result = '') {
    resolver(result);
    dispatch('close');
  }
</script>

<DialogTemplate>
  <svelte:fragment slot="header">外部阅读</svelte:fragment>
  <svelte:fragment slot="content">
    <p class="my-2">您正在从外部存储来源打开书籍。</p>
    <p class="my-2">
      注意: 每次都会重新下载完整书籍，并可能覆盖其他已配置的同步目标设置。
    </p>
    <p class="my-2">
      建议导出到本地浏览器并切换到浏览器存储视图阅读，以避免此问题。
    </p>
    <p class="flex items-center mt-4">
      <input id="show-hint" type="checkbox" bind:checked={$hideExternalReadHint$} />
      <label class="ml-2" for="show-hint">记住并隐藏此消息</label>
    </p>
  </svelte:fragment>
  <div class="flex flex-col sm:flex-row grow sm:justify-between" slot="footer">
    <button class={buttonClasses} on:click={() => closeDialog('cancel')}>
      取消
      <Ripple />
    </button>
    <button class={buttonClasses} on:click={() => closeDialog('export')}>
      打开导出
      <Ripple />
    </button>
    <button class={buttonClasses} on:click={() => closeDialog()}>
      确认
      <Ripple />
    </button>
  </div>
</DialogTemplate>
