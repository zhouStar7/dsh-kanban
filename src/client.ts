/**
 * Browser half of the kanban plugin.
 *
 * - mounts the `kanban` Typert Remote contribution (`ctx.remote.$mount`),
 * - exposes the 会话/看板 tab bridge consumed by the patched sidebar tabs
 *   (`window.__kanbanOpen` / `__kanbanClose` / `__kanbanIsOpen` + `kanban:statechange`),
 * - opens the kanban app in the DSH **main body area** — the center
 *   `conversation` column right of the sidebar — instead of a floating
 *   overlay popup: while open it registers a dynamic `conversation` slot
 *   entry at priority -1 that shadows the shipped conversation UI (a single
 *   slot renders its lowest-priority entry); disposing restores the surface.
 */
import * as React from 'react';
import { createElement, useEffect, useRef } from 'react';
import { KANBAN_REMOTE } from './remote';
import { mountKanban } from './kanban-entry';
import type { KanbanApi } from './lib/bridge';
import kanbanCss from './assets/index.css?inline';
import sonnerCss from 'vue-sonner/style.css?inline';

// ── CSS injection (matches the DSH `<style data-plugin-css>` pattern) ───────
function injectStyles() {
  const css = kanbanCss + '\n' + sonnerCss;
  const tagId = '@deepseek-kanban/plugin/kanban.css';
  if (typeof document !== 'undefined' && !document.querySelector(`style[data-plugin-css="${tagId}"]`)) {
    const tag = document.createElement('style');
    tag.dataset.plugin = '@deepseek-kanban/plugin';
    tag.dataset.pluginCss = tagId;
    tag.textContent = css;
    document.head.appendChild(tag);
  }
}

// ── kanban open/closed store (in-main-body) ─────────────────────────────────
let kanbanOpen = false;
let disposeKanbanEntry: (() => void) | null = null;
let kanbanContext: any = null; // captured plugin ctx for dynamic slots.register
let kanbanApi: KanbanApi | null = null;
const storeListeners = new Set<() => void>();

function getKanbanOpen() {
  return kanbanOpen;
}

function notifyStore() {
  storeListeners.forEach((l) => l());
}

function subscribeStore(l: () => void) {
  storeListeners.add(l);
  return () => {
    storeListeners.delete(l);
  };
}

function broadcastKanbanState() {
  window.dispatchEvent(new CustomEvent('kanban:statechange', { detail: { open: kanbanOpen } }));
}

function setKanbanOpen(open: boolean) {
  if (open === kanbanOpen) return;
  kanbanOpen = open;
  if (open) openKanban();
  else closeKanban();
  notifyStore();
  broadcastKanbanState();
}

/**
 * Open the kanban in the DSH main body: register a dynamic `conversation`
 * slot entry. The shipped conversation UI lives at priority 0, so we must
 * register at priority -1 — a single slot renders its lowest-priority entry —
 * and while this entry exists the center column shows the kanban instead of
 * the chat / hero surface.
 */
function openKanban() {
  if (disposeKanbanEntry !== null || kanbanContext === null || kanbanApi === null) return;
  disposeKanbanEntry = kanbanContext.slots.register(
    {
      name: 'conversation',
      // conversation 是 single 槽位：SlotCore 只渲染同 priority 里第一个注册的条目
      // （内置会话界面默认 priority 0 且先注册，永远赢）。必须用更低的 priority 才能遮蔽它。
      priority: -1,
      inject: () => ({ kanbanApi }),
    },
    KanbanMainView as any,
  );
}

function closeKanban() {
  if (disposeKanbanEntry) {
    try {
      disposeKanbanEntry();
    } catch {
      /* entry already removed by the unload cascade */
    }
    disposeKanbanEntry = null;
  }
}

// ── toggle hotkey (Ctrl+K / Cmd+K) ──────────────────────────────────────────
let toggleHotkeyCleanup: (() => void) | null = null;
function setupToggleHotkey(): void {
  toggleHotkeyCleanup?.();
  const onKeydown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey || e.shiftKey) return;
    if (e.key.toLowerCase() !== 'k') return;
    e.preventDefault();
    e.stopPropagation();
    setKanbanOpen(!kanbanOpen);
  };
  window.addEventListener('keydown', onKeydown, true);
  toggleHotkeyCleanup = () => window.removeEventListener('keydown', onKeydown, true);
}

// ── 会话/看板 tab 状态桥接（侧边栏 tab 由 patch-dsh-ui.mjs 注入并调用 window API）─

// ── main-body view (mounts the Vue kanban app into the conversation column) ─
function KanbanMainView(props: { kanbanApi: KanbanApi }) {
  // `kanbanApi` arrives through the entry's inject face; keep it in a ref so
  // the mount effect below can read the latest value without re-running.
  const apiRef = useRef(props.kanbanApi);
  apiRef.current = props.kanbanApi;
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const dispose = mountKanban(el, apiRef.current ?? (window as any).__kanbanApi, () => {
      setKanbanOpen(false);
    });
    return () => {
      dispose();
    };
  }, []);

  // Fill the center column exactly like the conversation surface it replaces.
  return createElement('div', {
    ref: hostRef,
    style: { flex: 1, minHeight: 0, height: '100%', width: '100%', overflow: 'hidden' },
  });
}

// ── plugin entry ────────────────────────────────────────────────────────────
export const inject = ['slots', 'remote'];

export async function apply(ctx: any) {
  injectStyles();
  setupToggleHotkey();
  kanbanContext = ctx;
  const remote = ctx.get('remote');
  await remote.$mount(KANBAN_REMOTE);
  kanbanApi = ctx.get('remote.kanban');
  // 暴露到 window：作为 useKanbanApi() 的兜底来源，也便于在控制台诊断远程调用。
  (window as any).__kanbanApi = kanbanApi;

  // 会话/看板 tab 状态桥接（patch-dsh-ui.mjs 注入的侧边栏 tab 调用这些 API）。
  const w = window as any;
  w.__kanbanIsOpen = () => kanbanOpen;
  w.__kanbanOpen = () => setKanbanOpen(true);
  w.__kanbanClose = () => setKanbanOpen(false);
  w.__kanbanToggle = () => setKanbanOpen(!kanbanOpen);

  // Plugin unload must restore the conversation surface and remove the bridge.
  ctx.effect(
    () => () => {
      setKanbanOpen(false);
      delete w.__kanbanIsOpen;
      delete w.__kanbanOpen;
      delete w.__kanbanClose;
      delete w.__kanbanToggle;
    },
    'kanban: restore conversation surface on unload',
  );
}
