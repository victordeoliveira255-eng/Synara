/* ============================================================
   SYNARA — Sistema de ícones SVG compartilhado
   Usado pela Central de Estudos (dashboard.js) e pelo Painel
   Administrativo (admin.html). Fonte única de paths/estilo.
   ============================================================ */
(function () {
  'use strict';

  const PATHS = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z"/>',
    mentor: '<path d="M12 3v3M12 18v3M4.5 7.5l2 2M17.5 14.5l2 2M3 12h3M18 12h3M4.5 16.5l2-2M17.5 9.5l2-2"/><circle cx="12" cy="12" r="3.2"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M4 20.5V6.5A2.5 2.5 0 0 1 6.5 4H8v14H6.5A2.5 2.5 0 0 0 4 20.5Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h.01M12 14h.01M17 14h.01"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m16 8 3-3M19 5h-3M19 5v3"/>',
    chart: '<path d="M4 19V5M4 19h17M8 16v-4M12 16V8M16 16v-6M20 16v-9"/>',
    heart: '<path d="M20.8 8.8c0 5.2-8.8 10.2-8.8 10.2S3.2 14 3.2 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z"/>',
    shield: '<path d="M12 3 20 6v5c0 5-3.3 8.4-8 10-4.7-1.6-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    'chevron-left': '<path d="m15 5-7 7 7 7"/>',
    'chevron-right': '<path d="m9 5 7 7-7 7"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="m4 20 4.5-1 9.8-9.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20ZM13.5 7.5l3 3"/>',
    key: '<circle cx="8" cy="15" r="3"/><path d="m10.5 12.5 8-8M15 7l2 2M17 5l2 2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    send: '<path d="M4 12 20 4l-7 16-2.5-6.5L4 12Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    timer: '<path d="M9 3h6M12 3v3"/><circle cx="12" cy="14" r="7"/><path d="M12 14V11M5.5 8.5 4 7M18.5 8.5 20 7"/>',
    play: '<path d="M7 5v14l12-7-12-7Z"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
    sparkle: '<path d="m12 3 1.6 6.4L20 11l-6.4 1.6L12 19l-1.6-6.4L4 11l6.4-1.6L12 3Z"/>',
    award: '<circle cx="12" cy="9" r="5"/><path d="m8.5 13.5-1.5 8 5-3 5 3-1.5-8"/>',
    document: '<path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 12h6M8 16h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
    leaf: '<path d="M20 4C10 4 4 9 4 16v4M20 4c0 9-6 14-13 14"/>',
    balance: '<path d="M12 4v16M6 8l-3 6h6l-3-6ZM18 8l-3 6h6l-3-6ZM6 8h12"/>',
    alert: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    pause: '<rect x="7" y="5" width="3.6" height="14" rx="1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    coffee: '<path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M4 21h16M8 3.5c0 1-1 1.2-1 2.2M12 3c0 1-1 1.2-1 2.2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.4 2.9-5.5 6.5-5.5s6.5 2.1 6.5 5.5"/><path d="M16.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.9c2.4.5 3.9 2 3.9 4.1"/>',
    activity: '<path d="M3 12h4l2.5-6 4 13 2.5-7h5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5M3 17l9 5 9-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>'
  };

  function icon(name, className) {
    const path = PATHS[name];
    if (!path) return '';
    return '<svg class="dashboard-icon ' + (className || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  function hydrate(root) {
    const scope = root || document;
    Array.prototype.slice.call(scope.querySelectorAll('[data-icon]')).forEach(function (node) {
      const svg = icon(node.getAttribute('data-icon'));
      if (svg) node.innerHTML = svg;
    });
  }

  window.SynaraIcons = { paths: PATHS, icon: icon, hydrate: hydrate, names: Object.keys(PATHS) };
})();