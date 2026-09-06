<script lang="ts">
  export let title: string;
  export let hint = '';
</script>

<div class="section-header lg:col-span-3">
  <h3>{title}</h3>
  {#if hint}<p>{hint}</p>{/if}
</div>

<style>
  /* Divider line lives at the TOP of each section header — i.e. it sits below
     the previous section's last row and visually closes that section, rather
     than separating the header from its own contents. Thin + low contrast so
     it reads as a quiet separator, not a heading underline. */
  .section-header {
    margin: 1.75rem 0 0.5rem;
    padding-top: 1.25rem;
    border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  }
  .section-header:first-child {
    margin-top: 0.25rem;
    padding-top: 0;
    border-top: none;
  }
  h3 {
    font-size: 1.6rem;
    font-weight: 700;
    margin: 0;
    line-height: 1.2;
  }
  p {
    font-size: 0.8rem;
    opacity: 0.65;
    margin: 0.35rem 0 0;
  }
</style>
