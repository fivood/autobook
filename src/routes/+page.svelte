<script lang="ts">
  import { t } from '$lib/i18n';
  import { goto } from '$app/navigation';
  import { pagePath } from '$lib/data/env';
  import { database, editFilePath$, pendingLaunchFiles$ } from '$lib/data/store';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { observe } from '$lib/functions/rxjs/use-observable';
  import { filter, map, tap } from 'rxjs';

  // IDB answers whenever it answers. A file opened from Explorer has already
  // been routed by the layout (to /edit or /manage) by then, and jumping to the
  // last book on top of that dropped the file on a cold start.
  const autoNavigate$ = database.lastItem$.pipe(
    filter(() => !editFilePath$.getValue() && !pendingLaunchFiles$.getValue().length),
    map((lastItem) => (lastItem ? `${pagePath}/b?id=${lastItem.dataId}` : 'manage')),
    tap(goto)
  );
</script>

<svelte:head>
  <title>{formatPageTitle($t('pageTitle.home'))}</title>
</svelte:head>

<div use:observe={autoNavigate$} />
