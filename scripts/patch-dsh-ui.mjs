/**
 * dsh-kanban UI patch for DSH Desktop built-in client bundles.
 *
 * 1. Sidebar: replace the「新会话」button with a 会话 / 看板 tab switcher
 *    (board state is driven by the plugin's window.__kanban* API).
 * 2. Workspace region: add a「新会话」icon button into the workspace header
 *    action group, BEFORE the search button.
 *
 * Idempotent: safe to re-run after a DSH update (re-detects the markers and
 * skips already-patched bundles). Creates "<file>.dsh-kanban.bak" backups.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const APP_ROOT = process.env.DSH_DESKTOP_RESOURCES || (process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '/Programs/DSH Desktop/resources/app' : 'C:/Users/24905/AppData/Local/Programs/DSH Desktop/resources/app');
const SIDEBAR = APP_ROOT + '/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js';
const WORKSPACE = APP_ROOT + '/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js';

function backup(path) {
  const bak = path + '.dsh-kanban.bak';
  if (!existsSync(bak)) copyFileSync(path, bak);
}

function patchSidebar(src) {
  if (src.includes('function KanbanSessionTabs')) return src;

  const component = [
    '',
    'function KanbanSessionTabs({ wide }) {',
    '\tvar state = react.useState(typeof window !== "undefined" && typeof window.__kanbanIsOpen === "function" ? window.__kanbanIsOpen() : false);',
    '\tvar open = state[0];',
    '\tvar setOpen = state[1];',
    '\tvar labelChat = wide ? "会话" : "会";',
    '\tvar labelBoard = wide ? "看板" : "板";',
    '\tvar fontSize = wide ? 11 : 9;',
    '\treact.useEffect(function() {',
    '\t\tfunction sync(e) {',
    '\t\t\tsetOpen(!!(e && e.detail && e.detail.open));',
    '\t\t}',
    '\t\twindow.addEventListener("kanban:statechange", sync);',
    '\t\treturn function() { window.removeEventListener("kanban:statechange", sync); };',
    '\t}, []);',
    '\tvar barStyle = { display: "flex", gap: 2, margin: wide ? "0 12px 8px" : "0 0 8px", padding: 2, borderRadius: 8, background: "var(--dsw-alias-fill-subtle, rgba(0,0,0,0.05))" };',
    '\tfunction tabStyle(active) {',
    '\t\treturn { flex: 1, height: 26, borderRadius: 6, border: "none", cursor: "pointer", fontSize: fontSize, lineHeight: "26px", padding: 0, background: active ? "var(--dsw-alias-panel-fill, #fff)" : "transparent", color: active ? "var(--dsw-alias-label-primary, #111)" : "var(--dsw-alias-label-tertiary, #666)" };',
    '\t}',
    '\treturn (0, react_jsx_runtime.jsxs)("div", { role: "tablist", "aria-label": "\u4f1a\u8bdd / \u770b\u677f", style: barStyle, children: [',
    '\t\t(0, react_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": !open, style: tabStyle(!open), onClick: function() { if (open && typeof window.__kanbanClose === "function") window.__kanbanClose(); }, children: labelChat }),',
    '\t\t(0, react_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": open, style: tabStyle(open), onClick: function() { if (!open && typeof window.__kanbanOpen === "function") window.__kanbanOpen(); }, children: labelBoard })',
    '\t]});',
    '}',
    ''
  ].join('\n');

  const regionLine = '//#region lib/types/client/SidebarRoot.js';
  const regionIdx = src.indexOf(regionLine);
  if (regionIdx === -1) throw new Error('sidebar: SidebarRoot region marker not found');
  src = src.slice(0, regionIdx) + component + '\n' + src.slice(regionIdx);

  const newSessionMarker = 'className: SidebarRoot_module_css_default.newSession,';
  const regionAreaMarker = 'className: SidebarRoot_module_css_default.regionArea,';
  const nsIdx = src.indexOf(newSessionMarker);
  const raIdx = src.indexOf(regionAreaMarker);
  if (nsIdx === -1 || raIdx === -1) throw new Error('sidebar: newSession/regionArea markers not found');
  const tooltipStart = src.lastIndexOf('(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {', nsIdx);
  const regionDivStart = src.lastIndexOf('(0, react_jsx_runtime.jsx)("div", {', raIdx);
  if (tooltipStart === -1 || regionDivStart === -1 || tooltipStart >= regionDivStart) {
    throw new Error('sidebar: block boundaries invalid (' + tooltipStart + ' / ' + regionDivStart + ')');
  }
  const block = src.slice(tooltipStart, regionDivStart);
  if (!block.includes('session.new.label')) throw new Error('sidebar: unexpected new-session block');

  const replacement = '(0, react_jsx_runtime.jsx)(KanbanSessionTabs, { wide }),\n\t\t\t\t\t';
  src = src.slice(0, tooltipStart) + replacement + src.slice(regionDivStart);
  return src;
}

function patchWorkspace(src) {
  if (src.includes('"data-plugin": "dsh-kanban"')) return src;

  // headerActions 默认 max-width:60px 只放得下两个图标，拉长到 100px 容纳三个按钮。
  const cssMarker = 'headerActions{opacity:1;visibility:visible;max-width:';
  const cssIdx = src.indexOf(cssMarker);
  if (cssIdx !== -1) {
    const from = cssIdx + cssMarker.length;
    const to = src.indexOf('px;', from);
    if (to !== -1) src = src.slice(0, from) + '100' + src.slice(to);
  }

  // headerActions 按钮组最终顺序：新会话（Tooltip，hover 同搜索）→ 添加工作区 → 视图选项。
  const t8 = '\t'.repeat(8);
  const t9 = '\t'.repeat(9);
  const t10 = '\t'.repeat(10);
  const t11 = '\t'.repeat(11);
  const t12 = '\t'.repeat(12);
  const oldBlock = [
    t8 + 'children: [wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {',
    t9 + 'groupBy,',
    t9 + 'orderBy,',
    t9 + 'onGroupPick: (mode) => {',
    t10 + 'actions.setGroupBy(mode);',
    t9 + '},',
    t9 + 'onOrderPick: (mode) => {',
    t10 + 'actions.setOrderBy(mode);',
    t9 + '},',
    t9 + 't',
    t8 + '}), directoryFlowAvailable && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {',
    t9 + 'label: t("workspace.add"),',
    t9 + 'side: "bottom",',
    t9 + 'delayMs: 500,',
    t9 + 'children: (0, react_jsx_runtime.jsx)("button", {',
    t10 + 'ref: wsPlusRef,',
    t10 + 'type: "button",',
    t10 + 'className: WorkspaceBrowser_module_css_default.iconButton,',
    t10 + '"aria-label": t("workspace.add"),',
    t10 + 'onClick: () => {',
    t11 + 'setWsPickerOpen((v) => !v);',
    t10 + '},',
    t10 + 'children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutline16, { size: wide ? 16 : 18 })',
    t9 + '})',
    t8 + '})]'
  ].join('\n');
  const oldIdx = src.indexOf(oldBlock);
  if (oldIdx === -1) throw new Error('workspace: headerActions children block not found');
  const newBlock = [
    t8 + 'children: [',
    t9 + 'wide && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {',
    t10 + 'label: t("session.new"),',
    t10 + 'side: "bottom",',
    t10 + 'delayMs: 500,',
    t10 + 'children: (0, react_jsx_runtime.jsx)("button", {',
    t11 + 'type: "button",',
    t11 + 'className: WorkspaceBrowser_module_css_default.searchButton,',
    t11 + '"data-plugin": "dsh-kanban",',
    t11 + '"aria-label": t("session.new"),',
    t11 + 'onClick: () => {',
    t12 + 'startSession();',
    t11 + '},',
    t11 + 'children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutline16, { size: 14 })',
    t10 + '})',
    t9 + '}),',
    t9 + 'directoryFlowAvailable && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {',
    t10 + 'label: t("workspace.add"),',
    t10 + 'side: "bottom",',
    t10 + 'delayMs: 500,',
    t10 + 'children: (0, react_jsx_runtime.jsx)("button", {',
    t11 + 'ref: wsPlusRef,',
    t11 + 'type: "button",',
    t11 + 'className: WorkspaceBrowser_module_css_default.iconButton,',
    t11 + '"aria-label": t("workspace.add"),',
    t11 + 'onClick: () => {',
    t12 + 'setWsPickerOpen((v) => !v);',
    t11 + '},',
    t11 + 'children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutline16, { size: wide ? 16 : 18 })',
    t10 + '})',
    t9 + '}),',
    t9 + 'wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {',
    t10 + 'groupBy,',
    t10 + 'orderBy,',
    t10 + 'onGroupPick: (mode) => {',
    t11 + 'actions.setGroupBy(mode);',
    t10 + '},',
    t10 + 'onOrderPick: (mode) => {',
    t11 + 'actions.setOrderBy(mode);',
    t10 + '},',
    t10 + 't',
    t9 + '})',
    t8 + ']'
  ].join('\n');
  src = src.slice(0, oldIdx) + newBlock + src.slice(oldIdx + oldBlock.length);
  return src;
}

backup(SIDEBAR);
backup(WORKSPACE);
let sidebar = readFileSync(SIDEBAR, 'utf8');
let workspace = readFileSync(WORKSPACE, 'utf8');
sidebar = patchSidebar(sidebar);
workspace = patchWorkspace(workspace);
writeFileSync(SIDEBAR, sidebar);
writeFileSync(WORKSPACE, workspace);
console.log('patched: dsh-client-ui-sidebar, dsh-client-ui-workspace');