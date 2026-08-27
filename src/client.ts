/**
 * Browser half of the kanban plugin.
 *
 * - mounts the kanban Typert Remote contribution (ctx.remote.$mount),
 * - replaces the stock sidebar declaratively (cordis.patch.yml disables
 *   ui-sidebar): this module registers its own sidebar slot owner with
 *   「会话 / 看板」tabs, while still rendering the official child slots
 *   (sidebar.workspaces / sidebar.settings / sidebar.footer.action)
 *   so other plugins keep their sidebar entries,
 * - exposes the legacy window.__kanbanOpen / __kanbanClose bridge for
 *   older installs that ran patch-dsh-ui.mjs,
 * - opens the kanban app in the DSH main body area — the center
 *   conversation column right of the sidebar — instead of a floating
 *   overlay popup: while open it registers a dynamic conversation slot
 *   entry at priority -1 that shadows the shipped conversation UI (a single
 *   slot renders its lowest-priority entry); disposing restores the surface.
 */
import * as React from 'react';
import { createElement, useEffect, useRef, useState } from 'react';
import { KANBAN_REMOTE } from './remote';
import { mountKanban } from './kanban-entry';
import type { KanbanApi } from './lib/bridge';
import kanbanCss from './assets/index.css?inline';
import sonnerCss from 'vue-sonner/style.css?inline';

// 官方 UI 原语（Tooltip 等）来自宿主 shell，bundle 时保持外部引用，
// 运行时经 __ModuleLoader__ factory 的 require 解析。
declare const require: (id: string) => any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const primitives: any = (() => {
  try {
    return require('@deepseek-ai/dsh-client-ui-primitives');
  } catch {
    return null; // 非 DSH 宿主（如单独 storybook 预览）下优雅降级
  }
})();
const OfficialTooltip: any = primitives ? primitives.Tooltip : null;
const reactDomClient: any = (() => {
  try {
    return require('react-dom/client');
  } catch {
    return null;
  }
})();

// ── CSS injection (matches the DSH <style data-plugin-css> pattern) ──────
function injectStyles() {
  const css = kanbanCss + '\n' + sonnerCss + '\n' +
    '[data-surface="sidebar"] button[data-kanban-brand]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05)); }\n' +
    // 官方 headerActions 组按 2 个按钮设计（max-width:60px + overflow:hidden），
    // 注入「新会话」后共 3 个（加搜索共 4），放宽到 4×28px+3×4px；搜索展开时
    // 官方切到 headerActionsHidden（max-width:0）隐藏整组，用 :not 排除避免内联
    // 样式盖掉隐藏态。
    '[data-surface="sidebar"] div[class*="headerActions"]:not([class*="headerActionsHidden"]) { max-width: 132px; }';
  const tagId = '@deepseek-kanban/plugin/kanban.css';
  if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="' + tagId + '"]')) {
    const tag = document.createElement('style');
    tag.dataset.plugin = '@deepseek-kanban/plugin';
    tag.dataset.pluginCss = tagId;
    tag.textContent = css;
    document.head.appendChild(tag);
  }
}

// ── kanban open/closed store (in-main-body) ─────────────────────────────────
let kanbanOpen = false;
let pendingOpen = false;
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
  if (open) {
    // 侧边栏可能先于 remote 挂载完成被点击：记下意图，apply 里补开。
    if (kanbanContext !== null && kanbanApi !== null) openKanban();
    else pendingOpen = true;
  } else {
    pendingOpen = false;
    closeKanban();
  }
  notifyStore();
  broadcastKanbanState();
}

/**
 * Open the kanban in the DSH main body: register a dynamic conversation
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

// ── self-written sidebar root ───────────────────────────────────────────────
// Replaces the stock sidebar (cordis.patch.yml disables ui-sidebar).
// Renders the same official child slots so other sidebar plugins keep working.
type KanbanTab = 'sessions' | 'board';

const SIDEBAR_ROOT_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minWidth: 0,
  background: 'var(--dsw-alias-bg-sidebar, var(--dsw-alias-bg-layer-1, #fff))',
  color: 'var(--dsw-alias-label-primary, #111)',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const LOGO_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  height: 52,
  padding: '8px 10px 2px',
  flex: 'none',
};

const BRAND_BUTTON_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  border: 'none',
  borderRadius: 10,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary, #111)',
  cursor: 'pointer',
  padding: '3px 6px',
};

const BRAND_LOCKUP_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const BRAND_MARK_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
};

const BRAND_NAME_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minWidth: 0,
  overflow: 'hidden',
};

// 与官方 iconButton 一致：28px 圆形、hover 浅底；折叠 rail 态 36px、主色。
function iconButtonStyle(collapsed: boolean): React.CSSProperties {
  return {
    width: collapsed ? 36 : 28,
    height: collapsed ? 36 : 28,
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '50%',
    background: 'transparent',
    color: collapsed ? 'var(--dsw-alias-label-primary, #111)' : 'var(--dsw-alias-label-secondary, #666)',
    cursor: 'pointer',
    padding: 0,
  };
}

// 官方 IconPanelLeftOutline16 原版 path（提取自 dsh-web-frontend 产物）。
const PANEL_ICON_HTML =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272ZM5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715ZM4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z"/></svg>';

// 官方 IconNewChatOutline16 原版 path（提取自 dsh-web-frontend 产物）。
const NEW_CHAT_ICON_HTML =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path fill="currentColor" d="M8.00003 0.3237C3.76075 0.3237 0.32373 3.76072 0.32373 8C0.32373 9.17603 0.589121 10.2922 1.0632 11.2901L1.35291 11.8989L2.5705 11.3205L2.28079 10.7117C1.89079 9.89074 1.67301 8.97167 1.67301 8C1.67301 4.50546 4.50549 1.67298 8.00003 1.67298C11.4946 1.67298 14.3271 4.50546 14.3271 8C14.3271 11.4945 11.4946 14.327 8.00003 14.327C7.28473 14.327 6.76077 14.277 6.29621 14.1487C5.83857 14.0224 5.40441 13.8109 4.88514 13.4488C4.12569 12.919 3.03778 12.7316 2.141 13.2978L2.12682 13.307L2.11264 13.3171L1.34886 13.854L1.79659 15.188L2.86122 14.4384C3.19068 14.2305 3.68325 14.2542 4.11326 14.5539C4.72789 14.9826 5.30042 15.2724 5.93762 15.4484C6.56803 15.6224 7.22776 15.6763 8.00003 15.6763C12.2393 15.6763 15.6763 12.2393 15.6763 8C15.6763 3.76072 12.2393 0.3237 8.00003 0.3237ZM7.32033 4.82535V7.32536H4.82538V8.67464H7.32033V11.1747H8.6696V8.67464H11.1747V7.32536H8.6696V4.82535H7.32033Z"/></svg>';

const TAB_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  margin: '0 10px 8px',
  padding: 2,
  borderRadius: 8,
  background: 'var(--dsw-alias-fill-subtle, rgba(0,0,0,0.05))',
  flex: 'none',
};

function tabButtonStyle(active: boolean, wide: boolean): React.CSSProperties {
  return {
    flex: 1,
    height: 26,
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: wide ? 11 : 9,
    lineHeight: '26px',
    padding: 0,
    background: active ? 'var(--dsw-alias-panel-fill, #fff)' : 'transparent',
    color: active ? 'var(--dsw-alias-label-primary, #111)' : 'var(--dsw-alias-label-tertiary, #666)',
  };
}

const REGION_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowX: 'hidden',
  overflowY: 'auto',
};

// 官方 workspaces 浏览器带负外边距（margin-right:-Npx 让列表滚动条贴边），
// 在我们的普通块容器里会把宽度撑出 1px+，侧边栏底部出现横向滚动条。
// 包一层 overflow hidden + 让内容自己恢复布局即可中和。
const WS_WRAP_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowX: 'hidden',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
};

const PANE_STYLE: React.CSSProperties = {
  padding: '0 10px 10px',
  height: '100%',
  minHeight: 0,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
};

const BOARD_PANE_STYLE: React.CSSProperties = {
  ...PANE_STYLE,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  textAlign: 'center',
};

const FOOTER_STYLE: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '6px 8px 8px',
  borderTop: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.06))',
  overflowX: 'hidden',
  minWidth: 0,
};

function KanbanSidebarRoot(props: any) {
  const { collapsed, width, startSession, toggleSidebar, renderSlot } = props;
  const [settled, setSettled] = useState(collapsed);
  const [tab, setTab] = useState<KanbanTab>(kanbanOpen ? 'board' : 'sessions');

  useEffect(() => {
    if (!collapsed) {
      setSettled(false);
      return;
    }
    const timer = window.setTimeout(() => setSettled(true), 150);
    return () => window.clearTimeout(timer);
  }, [collapsed]);

  // 外部关闭看板（返回按钮 / Ctrl+K / 卸载）时把 tab 一并切回「会话」。
  useEffect(() => subscribeStore(() => {
    setTab(kanbanOpen ? 'board' : 'sessions');
  }), []);

  // 「新会话」图标注入官方工作区头部按钮组（与搜索/视图/添加工作区同排，最前）。
  // 官方 WorkspaceBrowser 的按钮组没有插件槽位，只能对渲染结果做一次小注入：
  // 范围锁定在我们渲染的 workspaces 容器内，样式复用旁边官方按钮的 class。
  const wsWrapRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef(startSession);
  startRef.current = startSession;

  useEffect(() => {
    const wrap = wsWrapRef.current;
    if (!wrap) return;
    const MARK = 'data-kanban-new-session';
    let tooltipRoot: { unmount: () => void } | null = null;

    const useReactTooltip = OfficialTooltip !== null && reactDomClient !== null;

    const place = () => {
      const bar = wrap.querySelector<HTMLElement>('[class*="headerActions"]');
      if (!bar) return;

      // 不存在就创建（官方重渲染若清掉了我们的节点也会走到这里重建）。
      // Tooltip 可用时走 React（按钮也由 React 渲染，因为 Tooltip 内部
      // cloneElement(child) 只吃 React 元素）；否则退回原生 DOM 按钮。
      const existingHost = bar.querySelector<HTMLElement>('span[data-kanban-tooltip-host]');
      const existingBtn = bar.querySelector<HTMLElement>('[' + MARK + ']');
      if (!existingHost && !existingBtn) {
        if (tooltipRoot) {
          try { tooltipRoot.unmount(); } catch { /* already gone */ }
          tooltipRoot = null;
        }
        const sibling = bar.querySelector<HTMLElement>('button[class*="iconButton"]');
        const btnClass = sibling ? sibling.className : '';
        if (useReactTooltip) {
          const host = document.createElement('span');
          host.setAttribute('data-kanban-tooltip-host', '');
          host.style.display = 'contents';
          bar.insertBefore(host, bar.firstChild);
          const root = reactDomClient.createRoot(host);
          tooltipRoot = root;
          root.render(
            createElement(
              OfficialTooltip,
              { label: '新会话', side: 'bottom', delayMs: 500 },
              createElement('button', {
                type: 'button',
                className: btnClass,
                'aria-label': '新会话',
                [MARK]: '',
                style: { display: 'inline-flex' },
                onClick: (e: any) => {
                  e.stopPropagation();
                  startRef.current();
                },
                dangerouslySetInnerHTML: { __html: NEW_CHAT_ICON_HTML },
              }),
            ),
          );
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute(MARK, '');
          btn.setAttribute('aria-label', '新会话');
          btn.className = btnClass;
          btn.innerHTML = NEW_CHAT_ICON_HTML;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            startRef.current();
          });
          bar.insertBefore(btn, bar.firstChild);
        }
      }

      // 稳序：我们的入口（host 或按钮）永远在最前，且折叠 rail 态隐藏。
      const entry = (bar.querySelector<HTMLElement>('span[data-kanban-tooltip-host]') ||
        bar.querySelector<HTMLElement>('[' + MARK + ']')) as HTMLElement | null;
      if (entry) {
        if (bar.firstElementChild !== entry) bar.insertBefore(entry, bar.firstChild);
        // rail 只有 36px 宽一列，放不下 4 个图标；width>120 时才显示。
        (entry as HTMLElement).style.display = (wrap.clientWidth || 0) > 120 ? '' : 'none';
      }
    };
    place();
    const mo = new MutationObserver(place);
    mo.observe(wrap, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (tooltipRoot) {
        try { tooltipRoot.unmount(); } catch { /* already gone */ }
        tooltipRoot = null;
      }
      wrap.querySelectorAll('[' + MARK + '], span[data-kanban-tooltip-host]').forEach((n) => n.remove());
    };
  }, []);

  const wide = !collapsed || !settled;

  const chooseTab = (next: KanbanTab) => {
    setTab(next);
    setKanbanOpen(next === 'board');
  };

  // 头部行复刻官方结构：brand mark + brand name 子槽位（由
  // dsh-client-ui-brand-official 注入 logo 与字标），点击 = 新会话；
  // 折叠态只留展开按钮，与官方 rail 一致。
  const brandRow = createElement('div', { style: LOGO_ROW_STYLE }, [
    wide
      ? createElement('button', {
          type: 'button',
          style: BRAND_BUTTON_STYLE,
          'data-kanban-brand': '',
          'aria-label': '新建会话',
          onClick: () => startSession(),
        }, createElement('span', { style: BRAND_LOCKUP_STYLE }, [
          createElement('span', { style: BRAND_MARK_STYLE },
            renderSlot('sidebar.brand.mark', { size: 24 }) as any),
          createElement('span', { style: BRAND_NAME_STYLE },
            renderSlot('sidebar.brand.name', { wide }) as any),
        ]))
      : null,
    createElement('button', {
      type: 'button',
      style: iconButtonStyle(collapsed),
      'aria-label': collapsed ? '展开侧边栏' : '折叠侧边栏',
      onClick: () => toggleSidebar(),
      dangerouslySetInnerHTML: { __html: PANEL_ICON_HTML },
    }),
  ]);

  const tabRow = createElement('div', {
    style: TAB_ROW_STYLE,
    role: 'tablist',
    'aria-label': '会话 / 看板',
  }, [
    createElement('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': tab === 'sessions',
      style: tabButtonStyle(tab === 'sessions', wide),
      onClick: () => chooseTab('sessions'),
    }, wide ? '会话' : '会'),
    createElement('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': tab === 'board',
      style: tabButtonStyle(tab === 'board', wide),
      onClick: () => chooseTab('board'),
    }, wide ? '看板' : '板'),
  ]);

  const sessionsPane = createElement('div', { style: PANE_STYLE }, [
    createElement('div', {
      ref: wsWrapRef,
      'data-kanban-workspaces': '',
      style: WS_WRAP_STYLE,
    },
      renderSlot('sidebar.workspaces', {
        wide,
        expandSidebar: () => {
          if (collapsed) toggleSidebar();
        },
      }) as any),
  ]);

  const boardPane = createElement('div', { style: BOARD_PANE_STYLE }, [
    createElement('div', { style: { fontWeight: 600, fontSize: 13 } }, '看板已在主区域打开'),
    createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #888)' } },
      '按 Ctrl+K 可随时开关，点击「会话」tab 返回聊天'),
    createElement('button', {
      type: 'button',
      style: {
        height: 30,
        padding: '0 14px',
        border: 'none',
        borderRadius: 15,
        background: 'var(--dsw-alias-button-primary-fill, #2563eb)',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
        fontSize: 12,
        cursor: 'pointer',
      },
      onClick: () => setKanbanOpen(false),
    }, '返回会话'),
  ]);

  const region = createElement('div', { style: REGION_STYLE },
    tab === 'sessions' ? sessionsPane : boardPane);

  const footer = createElement('div', { style: FOOTER_STYLE }, [
    createElement('div', { style: { display: 'flex', gap: 2 } },
      renderSlot('sidebar.footer.action', { wide }) as any),
    createElement('div', { 'data-dsh-sidebar-settings': '', style: { display: 'flex', gap: 2 } },
      renderSlot('sidebar.settings', { wide }) as any),
  ]);

  return createElement('div', {
    'data-plugin': '@deepseek-kanban/plugin',
    'data-surface': 'sidebar',
    style: { ...SIDEBAR_ROOT_STYLE, width: wide && width ? width : undefined, overflowX: 'hidden' },
  }, [brandRow, tabRow, region, footer]);
}

// ── main-body view (mounts the Vue kanban app into the conversation column) ─
function KanbanMainView(props: { kanbanApi: KanbanApi }) {
  // kanbanApi arrives through the entry's inject face; keep it in a ref so
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
export const inject = ['slots', 'remote', 'workspaces', 'layout'];

export async function apply(ctx: any) {
  injectStyles();
  setupToggleHotkey();
  kanbanContext = ctx;

  // 自写侧边栏：官方 ui-sidebar 已在 cordis.patch.yml 中禁用，这里注册新的
  // sidebar owner（priority -1），并继续渲染官方子槽位，避免其他插件丢失入口。
  ctx.effect(
    () =>
      ctx.slots.register(
        {
          name: 'sidebar',
          priority: -1,
          children: {
            'sidebar.brand.mark': { kind: 'single', scope: 'root' },
            'sidebar.brand.name': { kind: 'single', scope: 'root' },
            'sidebar.workspaces': { kind: 'single', scope: 'root' },
            'sidebar.settings': { kind: 'single', scope: 'root' },
            'sidebar.footer.action': { kind: 'list', scope: 'root' },
          },
          inject: () => ({
            startSession: (workspaceId?: string) => ctx.workspaces.startSession(workspaceId),
            toggleSidebar: () => ctx.layout.toggleSidebar(),
          }),
        },
        KanbanSidebarRoot as any,
      ),
    'kanban: sidebar registration',
  );

  const remote = ctx.get('remote');
  await remote.$mount(KANBAN_REMOTE);
  kanbanApi = ctx.get('remote.kanban');
  // 暴露到 window：作为 useKanbanApi() 的兜底来源，也便于在控制台诊断远程调用。
  (window as any).__kanbanApi = kanbanApi;
  // 侧边栏在 remote 就绪前被点击时补开看板。
  if (pendingOpen) {
    pendingOpen = false;
    openKanban();
  }

  // 会话/看板 tab 状态桥接（兼容旧版 patch-dsh-ui.mjs 注入的侧边栏 tab）。
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
