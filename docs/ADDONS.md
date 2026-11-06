# Writing add-ons

An add-on is an ES module that exports an object with an `id`, a `name` and an `activate(api)` function. No build step is needed: a single `.js` file works.

```js
// hello.js
export default {
  id: 'me.hello',            // unique, reverse-domain style is a good habit
  name: 'Hello Board',
  version: '1.0.0',
  description: 'Adds a 1x6 shelf board.',

  activate(api) {
    api.registerCommand({
      id: 'me.hello.board',
      label: 'Add Shelf Board',      // appears in the Add-ons menu
      run() {
        api.transact('Shelf Board', () =>
          api.createBox({ width: 36, depth: 5.5, height: 0.75, name: 'Shelf', color: '#e3c58f', attributes: { material: 'Pine' } }),
        );
      },
    });
  },
};
```

Load it with **Add-ons → Add-on Manager → Load add-on file…**. It's saved and reloads automatically next time.

Built-in add-ons live in [`/addons`](../addons) (Lumber, Steel Profiles, Cut List) and use exactly the same API. A larger example is [`examples/addons/cabinet-box.js`](../examples/addons/cabinet-box.js).

> Add-ons run with full access to the app and the user's model. Users should only load code they trust, so keep add-ons readable and avoid minifying them.

## Units

All lengths in the API are **inches**. Use `api.units.parse("19mm")` → `0.748…` and `api.units.format(1.5)` → `1 1/2"` (or `38 mm` in metric models) to convert. Form fields of type `length` accept any unit and hand you inches.

Axes: **red = X**, **green = Y**, **blue = Z (up)**.

## The API

| Member | What it does |
| --- | --- |
| `api.apiVersion` | `"1.0"`. Minor versions only add things. |
| `api.THREE` | The three.js module, for `Vector3`, `Matrix4`… |
| `api.doc` | The `WorkbenchDocument`: `root` group, `units`, `bounds()`, `findGroup(id)`, `newGroup(name)`. |
| `api.context()` | The group being edited (the root if none). |
| `api.selection()` | `{ faces, edges, groups }` in the current context. |
| `api.setSelection({ faces?, edges?, groups? })` | Select by id. |
| `api.setTool(id)` | Switch tools (`select`, `line`, `rect`, `circle`, `pushpull`, `move`, `rotate`, `tape`, `eraser`, `paint`, `orbit`, `pan`, `zoom`). |
| `api.transact(label, fn)` | Run `fn` as one undo step. If it throws, the change is rolled back. **Wrap every model change in this.** |
| `api.createBox(opts)` | A rectangular solid in its own group. `width` (red), `depth` (green), `height` (blue), `origin`, `name`, `color`, `attributes`, `parent`. |
| `api.createExtrusion(opts)` | A 2D `profile` (with optional `holes`) pushed to `length` along `axis` (`'x'`, `'y'` or `'z'`). Ideal for tube, trim, extrusions. |
| `api.registerCommand({ id, label, menu?, shortcut?, run, enabled?, context? })` | Adds a menu item. Default menu is **Add-ons**. Shortcuts look like `"Mod+Shift+K"` (Mod = ⌘ on Mac, Ctrl elsewhere). `context: true` also shows it in the right-click menu whenever `enabled()` returns true. |
| `api.registerTool(tool)` | Adds a toolbar tool. See below. |
| `api.ui.form(title, fields, submitLabel?)` | Shows a form, resolves with values or `null` if cancelled. Field types: `length`, `number`, `text`, `select`, `checkbox`, `color`. |
| `api.ui.dialog(title, htmlOrElement, buttons?)` | A simple modal. Resolves with the clicked button's label. |
| `api.ui.toast(message, 'info' \| 'error')` | A short notice. |
| `api.ui.download(fileName, data)` | Save text or bytes. |
| `api.on('change' \| 'selection', fn)` | Subscribe; returns an unsubscribe function. |
| `api.storage.get/set(key, value)` | Persistent per-add-on settings. |
| `api.icons` | The built-in toolbar icons (SVG strings). |

### Components, tags and other model data

- `api.doc.makeComponent(context, faceIds, edgeKeys, groups, name)` / `api.doc.groupToComponent(group)` turn geometry or a group into a component; `api.doc.instances(componentId)` lists its copies. Copy an instance with `api.doc.duplicateGroup(g)`; edits made inside any instance are mirrored to the others.
- `group.tag = 'Cabinets'` puts a part on a tag (add `{ name, visible }` to `api.doc.tags` first).
- `api.doc.guides`, `api.doc.dimensions`, `api.doc.sections` and `api.doc.scenes` are plain arrays of JSON objects (see `src/core/document.ts`); change them inside `api.transact`.

### Groups and attributes

Each part should be its own group so it stays separate and shows up in the cut list. `group.attributes` is free-form data saved with the model, which is handy for species, finish, part numbers or supplier SKUs. The Cut List reads `attributes.material`.

### Working with raw geometry

`group.mesh` is the editable geometry. The useful calls:

```js
const mesh = api.context().mesh;
const face = mesh.addPolygon([new api.THREE.Vector3(0,0,0), /* … */]); // face (or hole + inner face if drawn on a face)
mesh.pushPull(face.id, -2);          // ground faces point down: negative pulls them up
const a = mesh.vertexAt(p1), b = mesh.vertexAt(p2);
mesh.addLine(a, b);                  // splits faces / closes loops like the Line tool
mesh.faces, mesh.verts, mesh.normal(face), mesh.area(face)
```

### Tools

A tool receives pointer events with canvas coordinates and a 3D ray. Use `app.infer(e, opts)` to get snapped points, exactly like the built-in tools.

```js
api.registerTool({
  id: 'me.post', name: 'Place Post', shortcut: 'K', icon: api.icons.board,
  hint: 'Click to place a 4x4 post.',
  pointerMove(e, app) { app.showInference(app.infer(e)); },
  pointerDown(e, app) {
    const p = app.infer(e).point;
    api.transact('Post', () => api.createBox({ width: 3.5, depth: 3.5, height: 96, origin: [p.x - 1.75, p.y - 1.75, p.z], name: '4x4 post' }));
  },
  vcb(text, app) { /* typed values; return true if used */ return false; },
  cancel(app) { app.escapeDefault(); },
});
```

`app` here is the internal `App` object. Its public-ish members (`infer`, `showInference`, `setVCB`, `setHint`, `vp.overlayLines`, `vp.clearOverlay`, `live(label)`) are what built-in tools in [`src/tools`](../src/tools) use, so read those for patterns. Anything not listed in the table above may change between versions.

## Sharing add-ons

Publish your add-on as a GitHub repo or gist containing the `.js` file and a short README. Good general-purpose add-ons can be proposed for the built-in set with a pull request that adds them under `/addons`.
