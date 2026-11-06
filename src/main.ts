import './styles.css';
import { App } from './app/app';
import { registerCommands, restoreAutosave } from './app/commands';
import { CircleTool, LineTool, RectangleTool } from './tools/draw';
import { MoveTool, OrbitTool, PanTool, PushPullTool, RotateTool, ZoomTool } from './tools/modify';
import { ArcTool, DimensionTool, OffsetTool, PolygonTool, ScaleTool, SectionTool, TapeTool } from './tools/more';
import { EraserTool, PaintTool, SelectTool } from './tools/select';
import { AddOnManager } from './plugins/api';
import { TOOL_MENUS, UI } from './ui/ui';
import { enableFileDrop, setupDesktop } from './app/desktop';
import { isDesktopApp, isMac, isWindows, os } from './app/os';
import { onSettings, settings } from './app/settings';
import { renderSettings } from './ui/settingsView';
import { dialog } from './ui/dialogs';
import lumber from '../addons/lumber';
import steel from '../addons/steel';
import cutlist from '../addons/cutlist';

/** Platform and theme classes on <html>: the CSS follows each OS's conventions. */
function applyPlatform(): () => boolean {
  const html = document.documentElement;
  html.classList.add(`os-${os}`);
  if (isDesktopApp) html.classList.add('desktop');
  const params = new URLSearchParams(location.search);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const isDark = () => {
    const forced = params.get('theme');
    if (forced === 'dark' || forced === 'light') return forced === 'dark';
    // Windows lets people pick an app theme; on a Mac the system decides
    if (isWindows && settings().theme !== 'system') return settings().theme === 'dark';
    return !!media?.matches;
  };
  const apply = () => {
    const dark = isDark();
    html.classList.toggle('theme-dark', dark);
    html.classList.toggle('theme-light', !dark);
  };
  apply();
  media?.addEventListener?.('change', apply);
  onSettings(apply);
  return isDark;
}

async function boot() {
  const isDark = applyPlatform();
  if (new URLSearchParams(location.search).get('view') === 'settings') {
    // the Mac Settings window: just the settings, no model
    const root = document.getElementById('app')!;
    root.className = 'settings-window';
    renderSettings(root, null);
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey && e.key === 'w') || e.key === 'Escape') import('@tauri-apps/api/window').then((w) => w.getCurrentWindow().close());
    });
    return;
  }
  const root = document.getElementById('app')!;
  const stage = document.createElement('main');
  stage.className = 'stage';
  const app = new App(stage);
  const addOns = new AddOnManager(app);

  for (const t of [
    new SelectTool(),
    new EraserTool(),
    new PaintTool(),
    new LineTool(),
    new RectangleTool(),
    new ArcTool(),
    new CircleTool(),
    new PolygonTool(),
    new PushPullTool(),
    new OffsetTool(),
    new MoveTool(),
    new RotateTool(),
    new ScaleTool(),
    new TapeTool(),
    new DimensionTool(),
    new SectionTool(),
    OrbitTool,
    PanTool,
    ZoomTool,
  ])
    app.registerTool(t);
  registerCommands(app, addOns);

  const ui = new UI(app, root, stage);
  for (const a of [lumber, steel, cutlist]) await addOns.activate(a, true);
  await addOns.restore();

  // the viewport follows light/dark too
  app.vp.setTheme(isDark());
  const themeSync = () => {
    app.vp.setTheme(isDark());
    app.refresh();
  };
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', themeSync);
  onSettings(themeSync);

  // Settings: a separate window on a Mac desktop (desktop.ts), a dialog everywhere else
  if (!(isDesktopApp && isMac))
    app.on('settings', () => {
      const box = document.createElement('div');
      box.classList.add('in-dialog');
      renderSettings(box, app);
      dialog('Settings', box, ['Done'], true);
    });

  const st = settings();
  app.doc.units = { system: st.units, fraction: st.fraction, mmDecimals: st.mmDecimals };
  const restored = st.restoreSession && restoreAutosave(app);
  app.setTool('select');
  app.refresh();
  if (restored) {
    app.vp.zoomExtents(app.modelBounds());
    app.toast('Restored your last session.', 'info', { label: 'Start new', run: () => app.runCommand('file.new') });
  } else app.vp.setStandardView('iso', app.modelBounds());
  if (settings().showWelcome) ui.welcome(stage);
  enableFileDrop(app, stage);
  await setupDesktop(app, TOOL_MENUS).catch((e) => console.error('desktop setup failed', e));

  window.addEventListener('beforeunload', (e) => {
    if (app.doc.dirty) e.preventDefault();
  });
  // handy for debugging and for add-on authors poking around in devtools
  Object.assign(window, { workbench: app, workbenchAddOns: addOns });
}

boot();
