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

const SIDEBAR = 'C:/Users/24905/AppData/Local/Programs/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js';
const WORKSPACE = 'C:/Users/24905/AppData/Local/Programs/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js';

function backup(path) {
  const bak = path + '.dsh-kanban.bak';
  if (!existsSync(bak)) copyFileSync(path, bak);
}

function patchSidebar(src) {
  if (src.includes('function KanbanSessionTabs')) return src;

  const component = [
    '',
    'function KanbanSessionTabs() {',
    '\tvar state = react.useState(typeof window !== "undefined" && typeof window.__kanbanIsOpen === "function" ? window.__kanbanIsOpen() : false);',
    '\tvar open = state[0];',
    '\tvar setOpen = state[1];',
    '\treact.useEffect(function() {',
    '\t\tfunction sync(e) {',
    '\t\t\tsetOpen(!!(e && e.detail && e.detail.open));',
    '\t\t}',
    '\t\twindow.addEventListener("kanban:statechange", sync);',
    '\t\treturn function() { window.removeEventListener("kanban:statechange", sync); };',
    '\t}, []);',
    '\tvar barStyle = { display: "flex", gap: 2, margin: "0 12px 8px", padding: 2, borderRadius: 8, background: "var(--dsw-alias-fill-subtle, rgba(0,0,0,0.05))" };',
    '\tfunction tabStyle(active) {',
    '\t\treturn { flex: 1, height: 26, borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, lineHeight: "26px", padding: 0, background: active ? "var(--dsw-alias-panel-fill, #fff)" : "transparent", color: active ? "var(--dsw-alias-label-primary, #111)" : "var(--dsw-alias-label-tertiary, #666)" };',
    '\t}',
    '\treturn (0, react_jsx_runtime.jsxs)("div", { role: "tablist", "aria-label": "\u4f1a\u8bdd / \u770b\u677f", style: barStyle, children: [',
    '\t\t(0, react_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": !open, style: tabStyle(!open), onClick: function() { if (open && typeof window.__kanbanClose === "function") window.__kanbanClose(); }, children: "\u4f1a\u8bdd" }),',
    '\t\t(0, react_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": open, style: tabStyle(open), onClick: function() { if (!open && typeof window.__kanbanOpen === "function") window.__kanbanOpen(); }, children: "\u770b\u677f" })',
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

  const replacement = '(0, react_jsx_runtime.jsx)(KanbanSessionTabs, {}),\n\t\t\t\t\t';
  src = src.slice(0, tooltipStart) + replacement + src.slice(regionDivStart);
  return src;
}

function patchWorkspace(src) {
  if (src.includes('data-plugin: "dsh-kanban"')) return src;

  const searchSlotMarker = 'className: clsx(WorkspaceBrowser_module_css_default.searchSlot, searchExpanded && WorkspaceBrowser_module_css_default.searchSlotExpanded),';
  const idx = src.indexOf(searchSlotMarker);
  if (idx === -1) throw new Error('workspace: searchSlot marker not found');
  const divStart = src.lastIndexOf('wide && (0, react_jsx_runtime.jsx)("div", {', idx);
  if (divStart === -1) throw new Error('workspace: search slot div start not found');

  const button = [
    'wide && (0, react_jsx_runtime.jsx)("button", {',
    '\t\t\t\t\t\t\t\ttype: "button",',
    '\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.iconButton,',
    '\t\t\t\t\t\t\t\t"data-plugin": "dsh-kanban",',
    '\t\t\t\t\t\t\t\t"aria-label": t("session.new"),',
    '\t\t\t\t\t\t\t\ttitle: t("session.new"),',
    '\t\t\t\t\t\t\t\tonClick: () => { startSession(); },',
    '\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutline16, { size: 14 })',
    '\t\t\t\t\t\t\t}),',
    '\t\t\t\t\t\t\t'
  ].join('\n');
  src = src.slice(0, divStart) + button + src.slice(divStart);
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