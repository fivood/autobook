<script lang="ts">
  /**
   * Startup probe for folders the narrowed fs scope can no longer reach.
   * Mounted once from the root layout; renders nothing itself.
   *
   * Deliberately not gated behind a "seen" flag: unlike a one-off hint, an
   * unreachable library root means sync is silently not writing, so the prompt
   * should come back every launch until the user actually re-picks it.
   */
  import { onMount } from 'svelte';
  import FsReauthorizeDialog from '$lib/components/fs-reauthorize-dialog.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { findUnreachableUserDirs } from '$lib/functions/fs-reauthorize';

  onMount(() => {
    let cancelled = false;

    findUnreachableUserDirs()
      .then((targets) => {
        if (cancelled || !targets.length) return;
        dialogManager.dialogs$.next([
          {
            component: FsReauthorizeDialog,
            props: { targets },
            disableCloseOnClick: true
          }
        ]);
      })
      .catch(() => {
        // Probing is best-effort: if the fs plugin itself is unavailable we
        // cannot tell reachable from unreachable, and guessing wrong here
        // would put a modal in front of someone whose setup is fine.
      });

    return () => {
      cancelled = true;
    };
  });
</script>
