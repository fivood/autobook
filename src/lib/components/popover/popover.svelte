<script lang="ts">
  import { browser } from '$app/environment';
  import { popovers } from '$lib/components/popover/popover';
  import { CLOSE_POPOVER } from '$lib/data/events';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import type { Instance, Placement } from '@popperjs/core';
  import flip from '@popperjs/core/lib/modifiers/flip';
  import offset from '@popperjs/core/lib/modifiers/offset';
  import { createPopper } from '@popperjs/core/lib/popper-lite';
  import { createEventDispatcher, tick } from 'svelte';

  export let contentText = '';
  export let containerStyles = '';
  export let innerContainerStyles = '';
  export let contentStyles = 'padding: 0';
  export let eventType = 'click';
  export let fallbackPlacements = ['left', 'bottom', 'right'];
  export let placement: Placement = 'top';
  export let singlePopover = true;
  export let xOffset = 0;
  export let yOffset = 10;

  const dispatch = createEventDispatcher<{
    open: void;
  }>();

  let contentElement: HTMLElement;
  let iconElement: HTMLElement;
  let popoverElement: HTMLElement;

  let id: symbol;
  let instance: Instance;
  let isOpen = false;

  $: if (browser) {
    id = Symbol('popover');
  }
  $: if (isOpen && singlePopover && !$popovers.includes(id)) {
    isOpen = false;
  }

  $: if (browser && iconElement) {
    iconElement.setAttribute('aria-expanded', `${isOpen}`);
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      toggleOpen();
    }
  }

  export async function toggleOpen(referenceElement?: HTMLElement | Event) {
    if (isOpen) {
      popovers.remove(id);
    } else if (singlePopover) {
      popovers.replace(id);
    } else {
      popovers.add(id);
    }

    isOpen = !isOpen;
    await tick();

    if (isOpen && instance) {
      instance.state.elements.reference = getTargetElement(referenceElement);
      instance.state.elements.popper = popoverElement;
      await instance.update().catch(() => {
        // no-op
      });
      await tick();
      dispatch('open');
    } else if (isOpen) {
      instance = createPopper(getTargetElement(referenceElement), popoverElement, {
        placement,
        modifiers: [
          flip,
          {
            name: 'flip',
            options: {
              fallbackPlacements
            }
          },
          offset,
          {
            name: 'offset',
            options: {
              offset: [xOffset, yOffset]
            }
          }
        ]
      });

      await tick();
      dispatch('open');
    }
  }

  /**
   * Keyboard activation for the trigger.
   *
   * The trigger is a bare `<div>` with a click listener, so every popover in
   * the app — the library's sort / filter / cover-size / language menus, the
   * reader's overflow — was unreachable without a mouse. Measured on the
   * library bar: 10 focusable controls, and none of those four among them.
   * Hover-type popovers are tooltips and stay mouse-only.
   */
  function onTriggerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleOpen(event.currentTarget as HTMLElement);
  }

  function conditionalClickHandlerAndClass(node: HTMLElement, conditionFulfilled: boolean) {
    if (conditionFulfilled) {
      node.classList.add('cursor-pointer');
      if (eventType === 'click') {
        node.classList.add('popover-trigger');
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        // The label lives on the icon inside the slot, so the wrapper we just
        // turned into a button would announce as a nameless "button".
        if (!node.getAttribute('aria-label')) {
          const labelled = node.querySelector('[title]')?.getAttribute('title');
          if (labelled) node.setAttribute('aria-label', labelled);
        }
        node.addEventListener('keydown', onTriggerKeydown, false);
        node.addEventListener('click', toggleOpen, false);
      } else {
        node.addEventListener('pointerenter', toggleOpen, false);
        node.addEventListener('pointerleave', toggleOpen, false);
      }
    } else {
      node.classList.remove('cursor-pointer');
      if (eventType === 'click') {
        node.classList.remove('popover-trigger');
        node.removeAttribute('tabindex');
        node.removeAttribute('role');
        node.removeAttribute('aria-label');
        node.removeEventListener('keydown', onTriggerKeydown, false);
        node.removeEventListener('click', toggleOpen, false);
      } else {
        node.removeEventListener('pointerenter', toggleOpen, false);
        node.removeEventListener('pointerleave', toggleOpen, false);
      }
    }

    return {
      destroy() {
        if (eventType === 'click') {
          node.removeEventListener('keydown', onTriggerKeydown, false);
          node.removeEventListener('click', toggleOpen, false);
        } else {
          node.removeEventListener('pointerenter', toggleOpen, false);
          node.removeEventListener('pointerleave', toggleOpen, false);
        }
      }
    };
  }

  function externalClose(node: HTMLElement) {
    node.addEventListener(CLOSE_POPOVER, toggleOpen, false);

    return {
      destroy() {
        node.removeEventListener(CLOSE_POPOVER, toggleOpen, false);
      }
    };
  }

  function getTargetElement(referenceElement?: HTMLElement | Event) {
    let targetElement;

    if (referenceElement instanceof HTMLElement) {
      targetElement = referenceElement;
    } else {
      targetElement = $$slots.icon ? iconElement : contentElement;
    }

    return targetElement;
  }
</script>

<svelte:window on:keydown={onWindowKeydown} />

<div data-popover class="flex items-center" style={containerStyles}>
  <div
    style={innerContainerStyles}
    use:conditionalClickHandlerAndClass={!$$slots.icon}
    bind:this={contentElement}
  >
    <slot />
  </div>
  <div use:conditionalClickHandlerAndClass={$$slots.icon} bind:this={iconElement}>
    <slot name="icon" />
  </div>
</div>

{#if isOpen}
  <div
    data-popover
    class="menu-surface max-w-60vw absolute z-40 md:max-w-lg"
    class:whitespace-pre-wrap={contentText}
    bind:this={popoverElement}
  >
    <div
      style={contentStyles}
      use:externalClose
      use:clickOutside={({ target }) => {
        if (!(target instanceof Element && target.closest('[data-popover]'))) {
          toggleOpen();
        }
      }}
    >
      {contentText}
      <slot name="content" />
    </div>
  </div>
{/if}

<style>
  /* The trigger only became focusable with this change; without a visible
     ring, tabbing through the bar would move focus into nowhere. */
  :global(.popover-trigger:focus-visible) {
    outline: 2px solid currentColor;
    outline-offset: -2px;
    border-radius: 0.25rem;
  }
</style>
