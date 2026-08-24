import { createApp, type App } from 'vue';
import AppRoot from './App.vue';
import { KANBAN_API, KANBAN_CLOSE, type KanbanApi } from './lib/bridge';

/**
 * Mount the kanban Vue app into a host-owned container element.
 * Returns a disposer that unmounts the app (React cleanup).
 *
 * @param el      the host container the app mounts into.
 * @param api     the kanban remote api the app talks to.
 * @param onClose optional callback invoked by the board's 「返回」 button so the
 *                host can close the main-body view and restore the conversation.
 */
export function mountKanban(el: HTMLElement, api: KanbanApi, onClose?: () => void): () => void {
  const app: App = createApp(AppRoot);
  app.provide(KANBAN_API, api);
  if (onClose) app.provide(KANBAN_CLOSE, onClose);
  app.mount(el);
  return () => {
    app.unmount();
  };
}
