import './styles.css';
import { App } from './app/app';
import { registerCommands, restoreAutosave } from './app/commands';
import { CircleTool, LineTool, RectangleTool } from './tools/draw';
import { MoveTool, OrbitTool, PanTool, PushPullTool, RotateTool, ZoomTool } from './tools/modify';
import { ArcTool, DimensionTool, OffsetTool, PolygonTool, ScaleTool, SectionTool, TapeTool } from './tools/more';
import { EraserTool, PaintTool, SelectTool } from './tools/select';
import { AddOnManager } from './plugins/api';
import { UI } from './ui/ui';
import lumber from '../addons/lumber';
import steel from '../addons/steel';
import cutlist from '../addons/cutlist';

async function boot() {
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

  const restored = restoreAutosave(app);
  app.setTool('select');
  app.refresh();
  if (restored) {
    app.vp.zoomExtents(app.modelBounds());
    app.toast('Restored your last session.', 'info', { label: 'Start new', run: () => app.runCommand('file.new') });
  } else app.vp.setStandardView('iso', app.modelBounds());
  ui.welcome(stage);

  window.addEventListener('beforeunload', (e) => {
    if (app.doc.dirty) e.preventDefault();
  });
  // handy for debugging and for add-on authors poking around in devtools
  Object.assign(window, { workbench: app, workbenchAddOns: addOns });
}

boot();
