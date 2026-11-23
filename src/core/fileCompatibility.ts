/**
 * Protect .wb3d documents from silently losing data written by newer editors.
 * Reject unsupported structural fields before any model state is replaced.
 * Add-on group.attributes is intentionally free-form user data.
 */
const schema = {
  document: ['format', 'version', 'units', 'nextGroupId', 'root', 'guides', 'dimensions', 'tags', 'scenes', 'sections', 'components', 'nextItemId'],
  group: ['id', 'name', 'matrix', 'mesh', 'children', 'hidden', 'tag', 'componentId', 'attributes'],
  mesh: ['nextId', 'verts', 'faces', 'lines'],
  face: ['id', 'outer', 'holes', 'color'],
  units: ['system', 'fraction', 'mmDecimals'],
  guide: ['id', 'point', 'dir'],
  dimension: ['id', 'a', 'b', 'offset'],
  tag: ['name', 'visible', 'color'],
  scene: ['name', 'camera', 'hiddenTags', 'activeSection'],
  camera: ['position', 'target', 'perspective'],
  section: ['id', 'point', 'normal', 'active'],
  component: ['id', 'name', 'description'],
} as const;

type Kind = keyof typeof schema;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function check(value: unknown, kind: Kind, path: string): void {
  if (!record(value)) return; // existing document decoder checks required shapes
  const recognized = schema[kind] as readonly string[];
  const unknown = Object.keys(value).filter((key) => !recognized.includes(key));
  if (unknown.length) {
    throw new Error(
      `Unsupported Workbench3D project data at ${path}: ${unknown.join(', ')}. ` +
      'This file may have been saved by a newer version. Update Workbench3D to edit it; the original file was not changed.',
    );
  }
  const child = (field: string, type: Kind) => {
    if (value[field] !== undefined) check(value[field], type, `${path}.${field}`);
  };
  const list = (field: string, type: Kind) => {
    if (Array.isArray(value[field])) {
      (value[field] as unknown[]).forEach((entry, i) => check(entry, type, `${path}.${field}[${i}]`));
    }
  };
  switch (kind) {
    case 'document':
      child('root', 'group');
      child('units', 'units');
      list('guides', 'guide');
      list('dimensions', 'dimension');
      list('tags', 'tag');
      list('scenes', 'scene');
      list('sections', 'section');
      list('components', 'component');
      break;
    case 'group':
      child('mesh', 'mesh');
      list('children', 'group');
      break;
    case 'mesh':
      list('faces', 'face');
      break;
    case 'scene':
      child('camera', 'camera');
      break;
  }
}

export function guardSupportedProjectFields(data: unknown): void {
  check(data, 'document', '$');
}
