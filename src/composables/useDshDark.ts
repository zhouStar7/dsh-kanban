import { onMounted, onUnmounted, ref } from 'vue';

/**
 * Mirror the DSH shell's dark-theme state onto the kanban root.
 *
 * The layout plugin (dsh-client-ui-layout) toggles `data-ds-dark-theme` on
 * <body> when the active theme resolves to dark; the kanban's token sets are
 * scoped to `.dsh-kanban-root` / `.dsh-kanban-root.dark`, so we watch that
 * attribute and flip the `dark` class accordingly.
 */
const DARK_ATTRIBUTE = 'data-ds-dark-theme';

export function useDshDark() {
  const isDark = ref(false);
  let observer: MutationObserver | null = null;

  function update() {
    isDark.value = typeof document !== 'undefined' && document.body.hasAttribute(DARK_ATTRIBUTE);
  }

  onMounted(() => {
    update();
    observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] });
  });

  onUnmounted(() => {
    observer?.disconnect();
    observer = null;
  });

  return { isDark };
}
