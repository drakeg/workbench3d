/** Original line icons for Workbench3D (24x24, stroke = currentColor). */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  select: svg('<path d="M5 3.5l12.5 7.2-5.6 1.2 3.3 6.1-2.3 1.2-3.3-6.1L5 17.2z"/>'),
  line: svg('<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><circle cx="20" cy="4" r="1.6" fill="currentColor"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="0.5"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="20" cy="18" r="1.4" fill="currentColor"/>'),
  circle: svg('<circle cx="12" cy="12" r="8"/><path d="M12 12h8"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'),
  pushpull: svg('<path d="M4 15l8 4 8-4-8-4z"/><path d="M12 11V3"/><path d="M9 6l3-3 3 3"/><path d="M4 15v-1M20 15v-1" opacity=".6"/>'),
  move: svg('<path d="M12 3v18M3 12h18"/><path d="M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>'),
  rotate: svg('<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17.5 3.5v4h-4"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'),
  tape: svg('<rect x="2.5" y="8" width="19" height="8" rx="1"/><path d="M6 8v3M9.5 8v4.5M13 8v3M16.5 8v4.5"/>'),
  eraser: svg('<path d="M8.5 19.5h11"/><path d="M3.8 14.2l9.4-9.4a1.8 1.8 0 0 1 2.5 0l3.5 3.5a1.8 1.8 0 0 1 0 2.5l-8.2 8.2H8.5z"/><path d="M8.6 9.4l6 6"/>'),
  paint: svg('<path d="M5 11l6-6 7 7-6 6a2 2 0 0 1-2.8 0L5 13.8A2 2 0 0 1 5 11z"/><path d="M5 11.5h13"/><path d="M19.5 15.5s1.5 1.9 1.5 2.9a1.5 1.5 0 0 1-3 0c0-1 1.5-2.9 1.5-2.9z"/>'),
  orbit: svg('<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M15.5 6.6l2.3 1.5-2 1.9"/><circle cx="12" cy="12" r="2.2"/>'),
  pan: svg('<path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10"/><path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V10"/><path d="M14 10V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.6 14.2a1.5 1.5 0 0 1 2.3-1.9L8 14.5V11"/>'),
  zoom: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 10.5h5M10.5 8v5"/>'),
  extents: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8.5" y="8.5" width="7" height="7"/>'),
  board: svg('<path d="M3 15l12-7 6 3.5-12 7z"/><path d="M3 15v2l6 3.5v-2M21 11.5v2l-12 7"/><path d="M8 12.5l1.5.9M12 10.3l1.5.9"/>'),
  steel: svg('<path d="M4 7h16v10H4z"/><path d="M7 10h10v4H7z"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.6"/>'),
};
