/*
 * Cumbrera — interfaz, editor de planta y vista 3D.
 */
(function () {
  'use strict';

  const G = globalThis.Cumbrera.geometry;
  const TPL = globalThis.Cumbrera.templates;
  const CALC = globalThis.Cumbrera.calc;
  if (!G || !TPL || !CALC) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'cumbrera.v1';
  const PALETTE = TPL.COLORS;
  const DEFAULT_ROOF = { pitch: 30, eaveHeight: 2.5 };
  const DEFAULT_SHEET = {
    width: 0.8,
    lateralOverlap: 0.04,
    maxLength: 6,
    lengthStep: 0.1,
    longitudinalOverlap: 0.15,
    endAllowance: 0.05,
  };
  const PRESETS = {
    zinc: { ...DEFAULT_SHEET },
    ondulada: {
      width: 1,
      lateralOverlap: 0.12,
      maxLength: 6,
      lengthStep: 0.1,
      longitudinalOverlap: 0.2,
      endAllowance: 0.05,
    },
  };

  const state = {
    roof: { ...DEFAULT_ROOF, panos: [] },
    sheet: { ...DEFAULT_SHEET },
    ui: {
      selectedId: null,
      tool: 'select',
      view: { k: 40, tx: 0, ty: 0 },
      draw: null,
      cursorWorld: null,
      labels3d: false,
      sheets3d: false,
      orbit: { az: 38, el: 36, zoom: 1 },
    },
  };

  const els = {};
  let analysis = null;
  let history = [];
  let future = [];
  let pointerState = null;
  let saveTimer = null;
  let toastTimer = null;
  let lastSavedKey = null;
  let lastSavedPayload = null;
  let pendingKey = null;
  let pendingPayload = null;
  let storageFailed = false;
  let idCounter = 0;
  let planSize = { w: 0, h: 0 };
  let drag3d = null;

  const NF = {};
  function fmt(value, decimals) {
    if (!Number.isFinite(value)) return '—';
    const d = Math.max(0, Math.min(3, decimals == null ? 1 : decimals));
    if (!NF[d]) {
      NF[d] = new Intl.NumberFormat('es-CL', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
    }
    return NF[d].format(value);
  }

  function fmtM(value, decimals) {
    return `${fmt(value, decimals == null ? 1 : decimals)} m`;
  }

  function fmtArea(value, decimals) {
    return `${fmt(value, decimals == null ? 1 : decimals)} m²`;
  }

  function roundInput(value, decimals) {
    return String(Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function uid() {
    idCounter += 1;
    return `p${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  }

  function readNumber(input) {
    const raw = String(input.value || '').trim().replace(',', '.');
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null) continue;
        node.setAttribute(key, String(value));
      }
    }
    return node;
  }

  function icon(name) {
    const svg = svgEl('svg', { class: 'icon', 'aria-hidden': 'true' });
    const use = svgEl('use', { href: `#i-${name}` });
    svg.appendChild(use);
    return svg;
  }

  function cacheDom() {
    const ids = [
      'templateGrid', 'saveState', 'saveStateText', 'headerSheets', 'helpBtn', 'exportBtn', 'resetBtn',
      'pitchInput', 'pitchBadge', 'eaveInput', 'ridgeInput', 'roofDerived',
      'principalLine', 'principalName', 'autoPitchesBtn',
      'sheetPreset', 'sheetBadge', 'sheetWidth', 'sheetOverlap', 'sheetMaxLength',
      'sheetStep', 'sheetLongOverlap', 'sheetMargin', 'sheetDerived',
      'statSheets', 'statLinear', 'statArea', 'statPurchased', 'statWaste',
      'wasteUseful', 'wastePct', 'cutsHint', 'cutChips', 'cutsNote',
      'selectTool', 'drawTool', 'undoBtn', 'redoBtn', 'zoomOutBtn', 'zoomInBtn', 'fitBtn',
      'cursorReadout', 'planWrap', 'planSvg', 'planWorld', 'gridLayer', 'panoLayer',
      'edgeLayer', 'unionLayer', 'labelLayer', 'drawLayer', 'planEmpty', 'emptyDrawBtn',
      'drawHint', 'drawHintText', 'drawCloseBtn', 'drawCancelBtn', 'scaleBar', 'scaleLabel',
      'panoTableBody', 'panoTableFoot', 'panoCountBadge', 'unionRidge', 'unionHip',
      'unionValley', 'labels3d', 'showSheets3d', 'resetViewBtn', 'view3d', 'view3dWrap',
      'view3dEmpty', 'viewHeights', 'panoEmpty', 'panoEditor', 'panoColor', 'panoName',
      'panoDelete', 'panoPrincipalBtn', 'panoPitchInput', 'panoRoleHint', 'panoPitchHint',
      'dialSvg', 'dialArrow', 'directionName', 'directionInput',
      'panoArea', 'panoRun', 'panoHeight', 'panoSheets', 'panoColumns', 'panoMaxPiece',
      'panoCutChips', 'panoCutsHint', 'vertexTable', 'warningsList', 'warningBadge',
      'helpDialog', 'helpClose', 'helpOk', 'methodBtn', 'toast',
    ];
    for (const id of ids) els[id] = document.getElementById(id);
  }

  /* ------------------------------------------------------------------ */
  /* Estado y persistencia                                              */
  /* ------------------------------------------------------------------ */

  function snapshot() {
    return JSON.stringify({ roof: state.roof, sheet: state.sheet });
  }

  function pushHistory() {
    history.push(snapshot());
    if (history.length > 80) history.shift();
    future = [];
    updateHistoryButtons();
  }

  function commitBefore(before) {
    if (!before) return;
    if (before === snapshot()) return;
    history.push(before);
    if (history.length > 80) history.shift();
    future = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (els.undoBtn) els.undoBtn.disabled = history.length === 0;
    if (els.redoBtn) els.redoBtn.disabled = future.length === 0;
  }

  function restoreSnapshot(payload) {
    const data = JSON.parse(payload);
    state.roof = data.roof;
    state.sheet = data.sheet;
    state.ui.draw = null;
    state.ui.tool = 'select';
    state.ui.cursorWorld = null;
    if (state.ui.selectedId && !state.roof.panos.some((p) => p.id === state.ui.selectedId)) {
      state.ui.selectedId = null;
    }
  }

  function undo() {
    if (!history.length) return;
    const current = snapshot();
    const previous = history.pop();
    future.push(current);
    restoreSnapshot(previous);
    render();
    fitPlan();
    renderPlan();
    draw3D();
    toast('Cambio deshecho');
  }

  function redo() {
    if (!future.length) return;
    const current = snapshot();
    const next = future.pop();
    history.push(current);
    restoreSnapshot(next);
    render();
    fitPlan();
    renderPlan();
    draw3D();
    toast('Cambio rehecho');
  }

  function prefs() {
    return { labels3d: state.ui.labels3d, sheets3d: state.ui.sheets3d };
  }

  function persistKey() {
    return JSON.stringify({
      version: 1,
      roof: state.roof,
      sheet: state.sheet,
      prefs: prefs(),
    });
  }

  function scheduleSave() {
    if (storageFailed) return;
    const key = persistKey();
    if (key === lastSavedKey || key === pendingKey) return;
    pendingKey = key;
    pendingPayload = JSON.stringify({
      version: 1,
      roof: state.roof,
      sheet: state.sheet,
      prefs: prefs(),
      updatedAt: new Date().toISOString(),
    });
    setSaveState('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 280);
  }

  function saveNow() {
    if (!pendingPayload) return;
    try {
      localStorage.setItem(STORAGE_KEY, pendingPayload);
      lastSavedPayload = pendingPayload;
      lastSavedKey = pendingKey;
      pendingPayload = null;
      pendingKey = null;
      setSaveState('saved');
    } catch (error) {
      storageFailed = true;
      pendingPayload = null;
      pendingKey = null;
      setSaveState('error');
    }
  }

  function setSaveState(kind) {
    if (!els.saveState) return;
    els.saveState.classList.toggle('is-saving', kind === 'saving');
    els.saveState.classList.toggle('is-error', kind === 'error');
    if (kind === 'saving') {
      els.saveStateText.textContent = 'Guardando…';
    } else if (kind === 'error') {
      els.saveStateText.textContent = 'Solo esta sesión';
    } else {
      els.saveStateText.textContent = 'Guardado local';
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || !data.roof) return false;
      const roof = sanitizeRoof(data.roof);
      if (!roof) return false;
      state.roof = roof;
      state.sheet = sanitizeSheet(data.sheet);
      if (data.prefs) {
        state.ui.labels3d = data.prefs.labels3d === true;
        state.ui.sheets3d = data.prefs.sheets3d === true;
      }
      if (roof.panos.length) state.ui.selectedId = roof.panos[0].id;
      lastSavedPayload = raw;
      lastSavedKey = persistKey();
      return true;
    } catch (error) {
      return false;
    }
  }

  function sanitizeSheet(raw) {
    const s = { ...DEFAULT_SHEET, ...(raw && typeof raw === 'object' ? raw : {}) };
    s.width = clamp(Number.isFinite(Number(s.width)) ? Number(s.width) : 0.8, 0.3, 3);
    s.lateralOverlap = clamp(
      Number.isFinite(Number(s.lateralOverlap)) ? Number(s.lateralOverlap) : 0.04,
      0,
      Math.max(0, s.width - 0.05)
    );
    s.maxLength = clamp(Number.isFinite(Number(s.maxLength)) ? Number(s.maxLength) : 6, 0.5, 20);
    s.lengthStep = clamp(
      Number.isFinite(Number(s.lengthStep)) ? Number(s.lengthStep) : 0.1,
      0.01,
      Math.min(1, s.maxLength)
    );
    s.longitudinalOverlap = clamp(
      Number.isFinite(Number(s.longitudinalOverlap)) ? Number(s.longitudinalOverlap) : 0.15,
      0,
      Math.max(0, s.maxLength - 0.15)
    );
    s.endAllowance = clamp(
      Number.isFinite(Number(s.endAllowance)) ? Number(s.endAllowance) : 0.05,
      0,
      1
    );
    return s;
  }

  function sanitizePano(raw, index, seenIds, defaultPitch) {
    if (!raw || typeof raw !== 'object') return null;
    const points = Array.isArray(raw.points)
      ? raw.points
          .filter((p) => Number.isFinite(Number(p && p.x)) && Number.isFinite(Number(p && p.y)))
          .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      : [];
    if (points.length < 3 || G.area(points) < 0.01) return null;
    let color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)
      ? raw.color
      : PALETTE[index % PALETTE.length];
    let id = typeof raw.id === 'string' && raw.id ? raw.id : uid();
    if (seenIds.has(id)) id = uid();
    seenIds.add(id);
    let direction = Number(raw.direction);
    if (!Number.isFinite(direction)) direction = 180;
    direction = ((direction % 360) + 360) % 360;
    const name = String(raw.name || `Agua ${index + 1}`).slice(0, 40).trim() || `Agua ${index + 1}`;
    const pitch = Number.isFinite(Number(raw.pitch))
      ? clamp(Number(raw.pitch), 1, 120)
      : defaultPitch;
    return { id, name, color, direction, points, pitch };
  }

  function sanitizeRoof(raw) {
    if (!raw || typeof raw !== 'object') return null;
    let pitch = clamp(Number.isFinite(Number(raw.pitch)) ? Number(raw.pitch) : 30, 1, 120);
    const eaveHeight = clamp(
      Number.isFinite(Number(raw.eaveHeight)) ? Number(raw.eaveHeight) : 2.5,
      0.5,
      20
    );
    const seen = new Set();
    const panos = Array.isArray(raw.panos)
      ? raw.panos
          .slice(0, 80)
          .map((p, index) => sanitizePano(p, index, seen, pitch))
          .filter(Boolean)
      : [];
    let principalId = null;
    if (panos.length) {
      const requested = panos.find((pano) => pano.id === raw.principalId);
      const principal =
        requested ||
        panos.reduce(
          (best, pano) => (G.area(pano.points) > G.area(best.points) ? pano : best),
          panos[0]
        );
      principalId = principal.id;
      pitch = principal.pitch;
    }
    return { pitch, eaveHeight, principalId, panos };
  }

  /* ------------------------------------------------------------------ */
  /* Acciones                                                           */
  /* ------------------------------------------------------------------ */

  function makePano(raw, pitch) {
    return {
      id: uid(),
      name: raw.name,
      color: raw.color,
      direction: raw.direction,
      points: raw.points.map((p) => ({ x: p.x, y: p.y })),
      pitch: Number.isFinite(Number(pitch))
        ? clamp(Number(pitch), 1, 120)
        : clamp(Number(state.roof.pitch) || 30, 1, 120),
    };
  }

  function selectedPano() {
    return state.roof.panos.find((p) => p.id === state.ui.selectedId) || null;
  }

  function selectedItem() {
    if (!analysis) return null;
    return analysis.panos.find((item) => item.pano.id === state.ui.selectedId) || null;
  }

  function ensurePrincipal() {
    for (const pano of state.roof.panos) {
      if (!Number.isFinite(Number(pano.pitch))) {
        pano.pitch = clamp(Number(state.roof.pitch) || 30, 1, 120);
      }
    }
    if (!state.roof.panos.length) {
      state.roof.principalId = null;
      return null;
    }
    let principal = state.roof.panos.find((pano) => pano.id === state.roof.principalId);
    if (!principal) {
      principal = state.roof.panos.reduce(
        (best, pano) => (G.area(pano.points) > G.area(best.points) ? pano : best),
        state.roof.panos[0]
      );
      state.roof.principalId = principal.id;
    }
    state.roof.pitch = clamp(Number(principal.pitch) || 30, 1, 120);
    return principal;
  }

  function principalPano() {
    const id = state.roof.principalId;
    return state.roof.panos.find((pano) => pano.id === id) || null;
  }

  function principalItem() {
    if (!analysis) return null;
    const id = state.roof.principalId;
    return analysis.panos.find((item) => item.pano.id === id) || null;
  }

  function pitchLabel(value) {
    const rounded = G.round(Number(value) || 0, 1);
    return `${fmt(rounded, Number.isInteger(rounded) ? 0 : 1)}%`;
  }

  function applyTemplate(id, options) {
    const opts = options || {};
    const template = TPL.byId(id);
    if (!template) return;
    if (opts.history !== false) pushHistory();
    const pitch = state.roof.pitch;
    const panos = template.build().map((pano) => makePano(pano, pitch));
    state.roof.panos = panos;
    state.roof.principalId = null;
    ensurePrincipal();
    state.ui.selectedId = state.roof.panos[0] ? state.roof.panos[0].id : null;
    state.ui.tool = 'select';
    state.ui.draw = null;
    state.ui.cursorWorld = null;
    pointerState = null;
    updateCursorReadout(null);
    render();
    if (opts.fit !== false) {
      fitPlan();
      renderPlan();
      draw3D();
    }
    if (!opts.silent) {
      toast(`Plantilla «${template.name}» aplicada · puedes deshacer`);
      revealPlanOnMobile();
    }
  }

  function revealPlanOnMobile() {
    if (window.matchMedia && window.matchMedia('(max-width: 980px)').matches) {
      els.planWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function resetAll() {
    if (!window.confirm('Se restaurará la techumbre de ejemplo y la configuración inicial de plancha. Podrás deshacer el cambio.')) {
      return;
    }
    pushHistory();
    const panos = TPL.byId('cuatroAguas')
      .build()
      .map((pano) => makePano(pano, DEFAULT_ROOF.pitch));
    state.roof = { ...DEFAULT_ROOF, principalId: null, panos };
    ensurePrincipal();
    state.sheet = { ...DEFAULT_SHEET };
    state.ui.selectedId = state.roof.panos[0] ? state.roof.panos[0].id : null;
    state.ui.tool = 'select';
    state.ui.draw = null;
    state.ui.cursorWorld = null;
    pointerState = null;
    updateCursorReadout(null);
    render();
    fitPlan();
    renderPlan();
    draw3D();
    toast('Diseño restaurado');
    revealPlanOnMobile();
  }

  function deleteSelected() {
    const pano = selectedPano();
    if (!pano) return;
    const index = state.roof.panos.indexOf(pano);
    pushHistory();
    const wasPrincipal = state.roof.principalId === pano.id;
    state.roof.panos.splice(index, 1);
    if (wasPrincipal) state.roof.principalId = null;
    const next = state.roof.panos[Math.min(index, state.roof.panos.length - 1)] || null;
    state.ui.selectedId = next ? next.id : null;
    render();
    if (!state.roof.panos.length) {
      fitPlan();
      renderPlan();
      draw3D();
    }
    toast(`«${pano.name}» eliminada`);
  }

  function selectPano(id) {
    if (state.ui.draw) cancelDraw(false);
    state.ui.tool = 'select';
    state.ui.selectedId = id;
    render();
  }

  function setSelectedAsPrincipal() {
    const pano = selectedPano();
    if (!pano) return;
    if (state.roof.principalId === pano.id) {
      toast('Esta agua ya es la principal');
      return;
    }
    pushHistory();
    state.roof.principalId = pano.id;
    state.roof.pitch = clamp(Number(pano.pitch) || 30, 1, 120);
    render();
    toast(`Agua principal: ${pano.name}`);
  }

  function autoAlignSecondaryPitches() {
    const principal = ensurePrincipal();
    if (!principal || state.roof.panos.length < 2) {
      toast('Necesitas al menos dos aguas para igualar alturas', 'error');
      return;
    }
    const result = CALC.autoAlignPitches(state.roof, principal.id);
    if (!result.changes.length) {
      const heightIssues = analysis.warnings.some((warning) =>
        warning.text.includes('alturas no coinciden')
      );
      if (result.skipped.length) {
        toast('No hay aguas conectadas que se puedan ajustar');
      } else if (heightIssues) {
        toast('No existe una pendiente constante que iguale todas las uniones');
      } else {
        toast('Las pendientes ya coinciden');
      }
      return;
    }
    pushHistory();
    for (const change of result.changes) {
      const pano = state.roof.panos.find((item) => item.id === change.panoId);
      if (pano) pano.pitch = change.pitch;
    }
    render();
    const total = result.changes.length;
    const skipped = result.skipped.length;
    const approximated = result.changes.filter((change) => change.mismatch > 0.03).length;
    let message = `Pendientes ajustadas en ${total} ${total === 1 ? 'agua' : 'aguas'}`;
    if (skipped) message += ` · ${skipped} sin ajuste`;
    if (approximated) message += ' · revisa las uniones';
    toast(message);
  }

  function nextColor() {
    const used = new Set(state.roof.panos.map((p) => p.color));
    return PALETTE.find((color) => !used.has(color)) || PALETTE[state.roof.panos.length % PALETTE.length];
  }

  function nextName() {
    return `Agua ${state.roof.panos.length + 1}`;
  }

  function setTool(tool) {
    if (tool === 'draw' && state.ui.tool === 'draw') {
      cancelDraw(true);
      return;
    }
    if (tool === 'draw') {
      if (state.ui.draw) cancelDraw(false);
      state.ui.tool = 'draw';
      state.ui.draw = { points: [] };
      state.ui.cursorWorld = null;
      state.ui.selectedId = null;
      pointerState = null;
      updateToolUI();
      updateDrawHint();
      updateEmpty();
      els.planSvg.classList.add('is-drawing');
      els.cursorReadout.textContent = '— · — m';
      renderProperties();
      renderPlan();
      toast('Haz clic para agregar vértices · Enter o clic en el primero para cerrar');
      return;
    }
    if (state.ui.draw) cancelDraw(false);
    state.ui.tool = 'select';
    state.ui.cursorWorld = null;
    updateToolUI();
    updateDrawHint();
    updateEmpty();
    els.planSvg.classList.remove('is-drawing');
    renderProperties();
    renderPlan();
  }

  function cancelDraw(notify) {
    const hadPoints = state.ui.draw && state.ui.draw.points.length > 0;
    state.ui.draw = null;
    state.ui.cursorWorld = null;
    state.ui.tool = 'select';
    updateCursorReadout(null);
    updateToolUI();
    updateDrawHint();
    updateEmpty();
    els.planSvg.classList.remove('is-drawing');
    renderProperties();
    renderPlan();
    if (notify && hadPoints) toast('Dibujo cancelado');
  }

  function finishDraw() {
    const draw = state.ui.draw;
    if (!draw || draw.points.length < 3) {
      toast('Un agua necesita al menos 3 vértices', 'error');
      return;
    }
    const points = draw.points.map((p) => ({ x: p.x, y: p.y }));
    if (G.distance(points[points.length - 1], points[0]) < 1e-6) points.pop();
    if (points.length < 3) {
      toast('Un agua necesita al menos 3 vértices', 'error');
      return;
    }
    if (!G.isSimplePolygon(points)) {
      toast('El contorno se cruza. Corrige los vértices o cancela el dibujo.', 'error');
      return;
    }
    if (G.area(points) < 0.1) {
      toast('El agua es demasiado pequeña. Dibuja una superficie mayor.', 'error');
      return;
    }
    const direction = G.inferDirection(points);
    pushHistory();
    const pano = {
      id: uid(),
      name: nextName(),
      color: nextColor(),
      direction,
      points,
      pitch: clamp(Number(state.roof.pitch) || 30, 1, 120),
    };
    state.roof.panos.push(pano);
    ensurePrincipal();
    state.ui.selectedId = pano.id;
    state.ui.draw = null;
    state.ui.tool = 'select';
    state.ui.cursorWorld = null;
    pointerState = null;
    updateCursorReadout(null);
    render();
    fitPlan();
    renderPlan();
    draw3D();
    toast(`Agua agregada · escurrimiento ${G.directionLabel(direction)}`);
  }

  /* ------------------------------------------------------------------ */
  /* Render principal                                                   */
  /* ------------------------------------------------------------------ */

  function render() {
    ensurePrincipal();
    state.sheet = sanitizeSheet(state.sheet);
    analysis = CALC.analyze(state.roof, state.sheet);
    if (state.ui.selectedId && !state.roof.panos.some((p) => p.id === state.ui.selectedId)) {
      state.ui.selectedId = null;
    }
    renderResults();
    renderTable();
    renderUnions();
    renderWarnings();
    renderProperties();
    syncInputs();
    updateToolUI();
    updateDrawHint();
    updateEmpty();
    renderPlan();
    draw3D();
    scheduleSave();
  }

  function renderResults() {
    const totals = analysis.totals;
    const hasPanos = analysis.panos.length > 0;
    const hasSheets = totals.sheets > 0;
    els.statSheets.textContent = hasPanos ? fmt(totals.sheets, 0) : '—';
    els.headerSheets.textContent = hasPanos ? fmt(totals.sheets, 0) : '—';
    els.statLinear.textContent = hasSheets ? fmtM(totals.linear, 1) : '—';
    els.statArea.textContent = hasPanos ? fmtArea(totals.roofArea, 1) : '—';
    els.statPurchased.textContent = hasSheets ? fmtArea(totals.purchasedArea, 1) : '—';
    els.statWaste.textContent = hasSheets ? `${fmt(totals.wastePct * 100, 0)}%` : '—';

    const usefulPct = totals.purchasedArea > 0
      ? clamp((totals.roofArea / totals.purchasedArea) * 100, 0, 100)
      : 0;
    els.wasteUseful.style.width = `${usefulPct}%`;
    els.wastePct.textContent = hasSheets ? `${fmt(usefulPct, 0)}%` : '—';

    const counts = [...totals.lengthCounts.values()];
    els.cutsHint.textContent = counts.length ? `${counts.length} ${counts.length === 1 ? 'largo' : 'largos'}` : '';
    renderCutChips(els.cutChips, counts, 6);
    const hasShort = counts.some((entry) => entry.length < 1);
    els.cutsNote.hidden = !(hasSheets && hasShort);
  }

  function renderCutChips(container, counts, limit) {
    container.replaceChildren();
    if (!counts.length) {
      const empty = document.createElement('span');
      empty.className = 'micro';
      empty.style.margin = '0';
      empty.textContent = 'Sin planchas todavía.';
      container.appendChild(empty);
      return;
    }
    const sortedByCount = [...counts].sort((a, b) => b.count - a.count || b.length - a.length);
    const primary = limit ? sortedByCount.slice(0, limit) : sortedByCount;
    const rest = limit ? sortedByCount.slice(limit) : [];
    const renderList = (list) => {
      const fragment = document.createDocumentFragment();
      const ordered = [...list].sort((a, b) => b.length - a.length);
      for (const entry of ordered) {
        const chip = document.createElement('span');
        chip.className = 'cut-chip';
        const length = document.createElement('strong');
        length.textContent = fmtM(entry.length, 2);
        const count = document.createElement('span');
        count.textContent = `× ${entry.count}`;
        chip.append(length, count);
        fragment.appendChild(chip);
      }
      return fragment;
    };
    container.appendChild(renderList(primary));
    if (rest.length) {
      const details = document.createElement('details');
      details.className = 'more-cuts';
      const summary = document.createElement('summary');
      summary.textContent = `${rest.length} ${rest.length === 1 ? 'largo más' : 'largos más'}`;
      const list = document.createElement('div');
      list.className = 'chips';
      list.appendChild(renderList(rest));
      details.append(summary, list);
      container.appendChild(details);
    }
  }

  function renderTable() {
    const body = els.panoTableBody;
    const foot = els.panoTableFoot;
    body.replaceChildren();
    foot.replaceChildren();
    const panos = state.roof.panos;
    els.panoCountBadge.textContent = `${panos.length} ${panos.length === 1 ? 'agua' : 'aguas'}`;

    if (!panos.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'table-empty';
      cell.textContent = 'Sin aguas. Dibuja una o elige una plantilla.';
      row.appendChild(cell);
      body.appendChild(row);
      foot.hidden = true;
      return;
    }
    foot.hidden = false;

    for (const item of analysis.panos) {
      const row = document.createElement('tr');
      row.dataset.id = item.pano.id;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      if (item.pano.id === state.ui.selectedId) {
        row.classList.add('is-selected');
        row.setAttribute('aria-selected', 'true');
      }
      const nameCell = document.createElement('td');
      const nameWrap = document.createElement('span');
      nameWrap.className = 'pano-cell';
      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.style.background = item.pano.color;
      const name = document.createElement('span');
      name.className = 'pano-name-cell';
      name.textContent = item.pano.name;
      nameWrap.append(dot, name);
      if (item.pano.id === state.roof.principalId) {
        const star = document.createElement('span');
        star.className = 'row-star';
        star.title = 'Agua principal';
        star.setAttribute('aria-label', 'Agua principal');
        star.textContent = '★';
        nameWrap.appendChild(star);
      }
      nameCell.appendChild(nameWrap);
      const area = document.createElement('td');
      area.className = 'num';
      area.textContent = fmtArea(item.metrics.areaRoof, 1);
      const pitchCell = document.createElement('td');
      pitchCell.className = 'num col-pitch';
      pitchCell.textContent = pitchLabel(item.metrics.pitch);
      const sheets = document.createElement('td');
      sheets.className = 'num';
      sheets.textContent = fmt(item.layout.sheetCount, 0);
      const maxPiece = document.createElement('td');
      maxPiece.className = 'num';
      maxPiece.textContent = item.layout.maxPiece ? fmtM(item.layout.maxPiece, 2) : '—';
      row.append(nameCell, area, pitchCell, sheets, maxPiece);
      row.addEventListener('click', () => selectPano(item.pano.id));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectPano(item.pano.id);
        }
      });
      body.appendChild(row);
    }

    const totalRow = document.createElement('tr');
    const totalLabel = document.createElement('td');
    totalLabel.textContent = 'Total';
    const totalArea = document.createElement('td');
    totalArea.className = 'num';
    totalArea.textContent = fmtArea(analysis.totals.roofArea, 1);
    const totalPitch = document.createElement('td');
    totalPitch.className = 'num col-pitch';
    totalPitch.textContent = '—';
    const totalSheets = document.createElement('td');
    totalSheets.className = 'num';
    totalSheets.textContent = fmt(analysis.totals.sheets, 0);
    const totalMax = document.createElement('td');
    totalMax.className = 'num';
    const maxPieces = analysis.panos.map((p) => p.layout.maxPiece).filter((v) => v > 0);
    totalMax.textContent = maxPieces.length ? fmtM(Math.max(...maxPieces), 2) : '—';
    totalRow.append(totalLabel, totalArea, totalPitch, totalSheets, totalMax);
    foot.appendChild(totalRow);
  }

  function renderUnions() {
    const byKind = analysis.totals.byKind;
    const show = (value) => (value > 0.03 ? fmtM(value, 1) : '—');
    els.unionRidge.textContent = show(byKind.ridge);
    els.unionHip.textContent = show(byKind.hip);
    els.unionValley.textContent = show(byKind.valley);
  }

  function renderWarnings() {
    const list = els.warningsList;
    list.replaceChildren();
    const warnings = analysis.warnings;
    const hasPanos = analysis.panos.length > 0;

    if (!hasPanos) {
      els.warningBadge.textContent = 'Pendiente';
      const item = document.createElement('li');
      item.className = 'warning-item info';
      item.appendChild(icon('info'));
      const text = document.createElement('span');
      text.textContent = 'Aún no hay aguas. Dibuja una o aplica una plantilla para revisar el diseño.';
      item.appendChild(text);
      list.appendChild(item);
      return;
    }

    if (!warnings.length) {
      els.warningBadge.textContent = 'Sin novedades';
      const item = document.createElement('li');
      item.className = 'warning-item ok';
      item.appendChild(icon('check'));
      const text = document.createElement('span');
      text.textContent = 'Sin observaciones. Las uniones y las alturas están consistentes.';
      item.appendChild(text);
      list.appendChild(item);
      return;
    }

    els.warningBadge.textContent = `${warnings.length} ${warnings.length === 1 ? 'aviso' : 'avisos'}`;
    for (const warning of warnings) {
      const item = document.createElement('li');
      item.className = `warning-item ${warning.level === 'info' ? 'info' : 'warn'}`;
      item.appendChild(icon(warning.level === 'info' ? 'info' : 'warning'));
      const text = document.createElement('span');
      text.textContent = warning.text;
      item.appendChild(text);
      list.appendChild(item);
    }
  }

  function renderProperties() {
    const item = selectedItem();
    if (!item) {
      els.panoEmpty.hidden = false;
      els.panoEditor.hidden = true;
      return;
    }
    els.panoEmpty.hidden = true;
    els.panoEditor.hidden = false;
    const pano = item.pano;
    const isPrincipal = pano.id === state.roof.principalId;
    els.panoColor.style.background = pano.color;
    if (document.activeElement !== els.panoName) els.panoName.value = pano.name;
    if (document.activeElement !== els.directionInput) {
      els.directionInput.value = String(Math.round(pano.direction));
    }
    if (document.activeElement !== els.panoPitchInput) {
      els.panoPitchInput.value = roundInput(item.metrics.pitch, 1);
    }
    els.panoRoleHint.textContent = isPrincipal ? 'principal' : 'secundaria';
    els.panoRoleHint.classList.toggle('is-principal', isPrincipal);
    els.panoPitchHint.textContent = isPrincipal
      ? 'Esta agua es la referencia de alturas. Puedes ajustar su pendiente o editar la cumbrera principal.'
      : 'Personaliza su pendiente o usa «Igualar alturas» en Cubierta para coincidir con el agua principal.';
    els.panoPrincipalBtn.classList.toggle('is-principal', isPrincipal);
    els.panoPrincipalBtn.setAttribute('aria-pressed', String(isPrincipal));
    const principalTitle = isPrincipal ? 'Agua principal' : 'Marcar como agua principal';
    els.panoPrincipalBtn.title = principalTitle;
    els.panoPrincipalBtn.setAttribute('aria-label', principalTitle);
    els.directionName.textContent = G.directionLabel(pano.direction);
    els.dialArrow.setAttribute('transform', `rotate(${pano.direction} 46 46)`);
    els.panoArea.textContent = fmtArea(item.metrics.areaRoof, 1);
    els.panoRun.textContent = fmtM(item.metrics.run, 2);
    els.panoHeight.textContent = fmtM(item.metrics.maxHeight, 2);
    els.panoSheets.textContent = fmt(item.layout.sheetCount, 0);
    els.panoColumns.textContent = fmt(item.layout.columns, 0);
    els.panoMaxPiece.textContent = item.layout.maxPiece ? fmtM(item.layout.maxPiece, 2) : '—';
    els.panoCutsHint.textContent = `${item.layout.sheetCount} ${item.layout.sheetCount === 1 ? 'plancha' : 'planchas'}`;
    renderCutChips(els.panoCutChips, [...item.layout.lengthCounts.values()], 8);

    const active = document.activeElement;
    if (!els.vertexTable.contains(active)) {
      renderVertexTable(pano);
    }
  }

  function renderVertexTable(pano) {
    const table = els.vertexTable;
    table.replaceChildren();
    pano.points.forEach((point, index) => {
      const row = document.createElement('div');
      row.className = 'vertex-row';
      const label = document.createElement('span');
      label.className = 'vertex-label';
      label.textContent = `V${index + 1}`;
      row.appendChild(label);

      ['x', 'y'].forEach((axis) => {
        const field = document.createElement('label');
        field.className = 'vertex-field';
        const unit = document.createElement('span');
        unit.textContent = axis.toUpperCase();
        const input = document.createElement('input');
        input.className = 'vertex-input';
        input.type = 'number';
        input.step = '0.01';
        input.inputMode = 'decimal';
        input.value = point[axis].toFixed(2);
        input.setAttribute('aria-label', `Vértice ${index + 1}, coordenada ${axis.toUpperCase()}`);
        let before = null;
        input.addEventListener('focus', () => {
          before = snapshot();
        });
        input.addEventListener('change', () => {
          const next = readNumber(input);
          if (next == null) {
            input.value = point[axis].toFixed(2);
            return;
          }
          const oldPoint = { x: pano.points[index].x, y: pano.points[index].y };
          const newPoint = { x: oldPoint.x, y: oldPoint.y };
          newPoint[axis] = G.round(next, 3);
          if (newPoint.x === oldPoint.x && newPoint.y === oldPoint.y) {
            input.value = newPoint[axis].toFixed(2);
            return;
          }
          moveSharedVertex(oldPoint, newPoint);
          if (before) {
            commitBefore(before);
            before = snapshot();
          }
          render();
        });
        input.addEventListener('blur', () => {
          if (before) {
            commitBefore(before);
            before = null;
          }
        });
        field.append(unit, input);
        row.appendChild(field);
      });
      table.appendChild(row);
    });
  }

  function moveSharedVertex(oldPoint, newPoint) {
    for (const pano of state.roof.panos) {
      for (const point of pano.points) {
        if (G.distance(point, oldPoint) < 1e-6) {
          point.x = newPoint.x;
          point.y = newPoint.y;
        }
      }
    }
  }

  function setInputValue(input, value) {
    if (!input) return;
    if (document.activeElement === input) return;
    const next = typeof value === 'number' ? String(value) : value;
    if (input.value !== next) input.value = next;
  }

  function usableWidth() {
    return Math.max(0.01, state.sheet.width - state.sheet.lateralOverlap);
  }

  function detectPreset() {
    for (const [key, preset] of Object.entries(PRESETS)) {
      const matches = Object.keys(preset).every(
        (field) => Math.abs(Number(preset[field]) - Number(state.sheet[field])) < 1e-9
      );
      if (matches) return key;
    }
    return 'custom';
  }

  function syncInputs() {
    const principal = principalPano();
    const principalInfo = principalItem();
    const pitch = principal ? Number(principal.pitch) || 30 : state.roof.pitch;
    const eave = state.roof.eaveHeight;
    setInputValue(els.pitchInput, roundInput(pitch, 1));
    setInputValue(els.eaveInput, eave.toFixed(2));
    if (principalInfo && principalInfo.metrics.run > 0.01) {
      els.ridgeInput.disabled = false;
      els.ridgeInput.removeAttribute('title');
      setInputValue(els.ridgeInput, principalInfo.metrics.maxHeight.toFixed(2));
      const angle = (Math.atan(pitch / 100) * 180) / Math.PI;
      els.roofDerived.textContent = `Principal ${planLabel(principal.name)} · ${fmt(angle, 1)}° · Desarrollo ${fmtM(principalInfo.metrics.run, 2)}`;
      els.principalName.textContent = planLabel(principal.name);
    } else {
      els.ridgeInput.disabled = true;
      els.ridgeInput.value = '';
      els.ridgeInput.title = 'Agrega un agua para calcular la cumbrera';
      els.roofDerived.textContent = principal
        ? 'Agua principal sin desarrollo'
        : 'Sin agua principal';
      els.principalName.textContent = principal ? planLabel(principal.name) : '—';
    }
    els.principalLine.classList.toggle('has-principal', !!principal);
    els.pitchBadge.textContent = pitchLabel(pitch);
    els.autoPitchesBtn.disabled = !principal || state.roof.panos.length < 2;
    els.autoPitchesBtn.title =
      !principal || state.roof.panos.length < 2
        ? 'Agrega al menos dos aguas para usar el auto-ajuste'
        : `Calcula las pendientes de las secundarias conectadas a «${principal.name}»`;

    setInputValue(els.sheetWidth, state.sheet.width.toFixed(2));
    setInputValue(els.sheetOverlap, state.sheet.lateralOverlap.toFixed(2));
    setInputValue(els.sheetMaxLength, state.sheet.maxLength.toFixed(2));
    setInputValue(els.sheetStep, state.sheet.lengthStep.toFixed(2));
    setInputValue(els.sheetLongOverlap, state.sheet.longitudinalOverlap.toFixed(2));
    setInputValue(els.sheetMargin, state.sheet.endAllowance.toFixed(2));
    els.sheetBadge.textContent = `${fmt(usableWidth(), 2)} m útil`;
    els.sheetDerived.textContent = `Franjas de ${fmtM(usableWidth(), 2)} · Largo máximo ${fmtM(state.sheet.maxLength, 2)}`;
    els.sheetPreset.value = detectPreset();

    els.labels3d.checked = state.ui.labels3d;
    els.showSheets3d.checked = state.ui.sheets3d;
    if (analysis.panos.length) {
      els.viewHeights.textContent = `Alero ${fmtM(eave, 2)} · Cumbrera máx. ${fmtM(analysis.maxHeight, 2)}`;
    } else {
      els.viewHeights.textContent = 'Sin aguas';
    }

    const selected = selectedItem();
    if (selected) {
      if (document.activeElement !== els.panoName) els.panoName.value = selected.pano.name;
      if (document.activeElement !== els.directionInput) {
        els.directionInput.value = String(Math.round(selected.pano.direction));
      }
      if (document.activeElement !== els.panoPitchInput) {
        els.panoPitchInput.value = roundInput(selected.metrics.pitch, 1);
      }
    }
  }

  function updateToolUI() {
    const isDraw = state.ui.tool === 'draw';
    els.selectTool.classList.toggle('is-active', !isDraw);
    els.selectTool.setAttribute('aria-pressed', String(!isDraw));
    els.drawTool.classList.toggle('is-active', isDraw);
    els.drawTool.setAttribute('aria-pressed', String(isDraw));
    els.planSvg.classList.toggle('is-drawing', isDraw);
    updateHistoryButtons();
  }

  function updateEmpty() {
    const hideEmpty = state.roof.panos.length > 0 || !!state.ui.draw;
    els.planEmpty.hidden = hideEmpty;
    els.view3dEmpty.hidden = state.roof.panos.length > 0;
    const hidePlanChrome = state.roof.panos.length === 0 && !state.ui.draw;
    for (const selector of ['.plan-badge', '.plan-north', '.plan-scale', '.plan-legend']) {
      const node = $(selector);
      if (node) node.hidden = hidePlanChrome;
    }
  }

  function updateDrawHint() {
    const draw = state.ui.draw;
    const active = state.ui.tool === 'draw' && !!draw;
    els.drawHint.hidden = !active;
    if (!active) return;
    const count = draw.points.length;
    els.drawHintText.textContent = `Dibujando agua · ${count} ${count === 1 ? 'vértice' : 'vértices'}`;
    els.drawCloseBtn.disabled = count < 3;
  }

  /* ------------------------------------------------------------------ */
  /* Plano 2D                                                           */
  /* ------------------------------------------------------------------ */

  function svgPointFromEvent(event) {
    const rect = els.planSvg.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    return {
      x: (sx - state.ui.view.tx) / state.ui.view.k,
      y: (sy - state.ui.view.ty) / state.ui.view.k,
      sx,
      sy,
    };
  }

  function fitPlan() {
    const wrap = els.planWrap;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h || !analysis) return;
    let bounds = analysis.bbox;
    if (!bounds) bounds = { minX: -1, minY: -1, maxX: 13, maxY: 11, width: 14, height: 12 };
    const minX = bounds.minX - 1.9;
    const maxX = bounds.maxX + 0.9;
    const minY = bounds.minY - 0.9;
    const maxY = bounds.maxY + 1.9;
    const bw = Math.max(0.2, maxX - minX);
    const bh = Math.max(0.2, maxY - minY);
    const k = Math.max(0.5, Math.min((w - 26) / bw, (h - 26) / bh));
    const tx = w / 2 - ((minX + maxX) / 2) * k;
    const ty = h / 2 - ((minY + maxY) / 2) * k;
    state.ui.view = { k, tx, ty };
    planSize = { w, h };
    els.planWorld.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`);
  }

  function zoomPlanAt(factor, sx, sy) {
    const view = state.ui.view;
    const k = clamp(view.k * factor, 0.5, 1000);
    if (Math.abs(k - view.k) < 1e-9) return;
    const worldX = (sx - view.tx) / view.k;
    const worldY = (sy - view.ty) / view.k;
    view.k = k;
    view.tx = sx - worldX * k;
    view.ty = sy - worldY * k;
    els.planWorld.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`);
    renderPlan();
  }

  function renderPlan() {
    if (!els.planWrap) return;
    const w = els.planWrap.clientWidth;
    const h = els.planWrap.clientHeight;
    if (!w || !h) return;
    planSize = { w, h };
    els.planSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    els.planSvg.setAttribute('preserveAspectRatio', 'none');
    els.planWorld.setAttribute('transform', `translate(${state.ui.view.tx} ${state.ui.view.ty}) scale(${state.ui.view.k})`);
    for (const layer of [els.gridLayer, els.panoLayer, els.edgeLayer, els.unionLayer, els.labelLayer, els.drawLayer]) {
      layer.replaceChildren();
    }
    renderGrid(w, h);
    renderPlanPanos();
    renderPlanEdges();
    renderPlanUnions();
    renderPlanLabels();
    renderPlanDimensions();
    renderPlanSelection();
    updateScaleBar();
    updateDrawPreview();
  }

  function renderGrid(w, h) {
    const view = state.ui.view;
    const x0 = (-view.tx) / view.k;
    const x1 = (w - view.tx) / view.k;
    const y0 = (-view.ty) / view.k;
    const y1 = (h - view.ty) / view.k;
    const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50];
    const step = steps.find((s) => s * view.k >= 42) || 100;
    const majorStep = step * 5;
    const startX = Math.floor(x0 / step) * step;
    const startY = Math.floor(y0 / step) * step;
    const makeLine = (x1v, y1v, x2v, y2v, cls) => {
      const line = svgEl('line', {
        x1: x1v,
        y1: y1v,
        x2: x2v,
        y2: y2v,
        class: cls,
        'vector-effect': 'non-scaling-stroke',
      });
      els.gridLayer.appendChild(line);
    };
    for (let x = startX; x <= x1 + step * 0.5; x += step) {
      const rounded = G.round(x, 6);
      const isMajor = Math.abs(rounded / majorStep - Math.round(rounded / majorStep)) < 1e-6;
      makeLine(rounded, y0, rounded, y1, isMajor ? 'grid-major' : 'grid-minor');
    }
    for (let y = startY; y <= y1 + step * 0.5; y += step) {
      const rounded = G.round(y, 6);
      const isMajor = Math.abs(rounded / majorStep - Math.round(rounded / majorStep)) < 1e-6;
      makeLine(x0, rounded, x1, rounded, isMajor ? 'grid-major' : 'grid-minor');
    }
    if (x0 < 0 && x1 > 0) makeLine(0, y0, 0, y1, 'grid-axis');
    if (y0 < 0 && y1 > 0) makeLine(x0, 0, x1, 0, 'grid-axis');
  }

  function pathData(points, close) {
    if (!points.length) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) d += ` L ${points[i].x} ${points[i].y}`;
    if (close !== false) d += ' Z';
    return d;
  }

  function renderPlanPanos() {
    for (const item of analysis.panos) {
      const selected = item.pano.id === state.ui.selectedId;
      const path = svgEl('path', {
        d: pathData(item.pano.points),
        fill: item.pano.color,
        'fill-opacity': selected ? 0.2 : 0.13,
        stroke: 'none',
        class: 'pano-shape',
        'data-id': item.pano.id,
      });
      els.panoLayer.appendChild(path);
    }
  }

  function renderPlanEdges() {
    for (const item of analysis.panos) {
      const points = item.pano.points;
      const m = item.metrics;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const sa = a.x * m.d.x + a.y * m.d.y;
        const sb = b.x * m.d.x + b.y * m.d.y;
        const isEave = sa >= m.sMax - 1e-6 && sb >= m.sMax - 1e-6;
        const line = svgEl('line', {
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          class: isEave ? 'edge-eave' : 'edge-rake',
          'vector-effect': 'non-scaling-stroke',
        });
        els.edgeLayer.appendChild(line);
      }
    }
  }

  function renderPlanUnions() {
    const k = state.ui.view.k;
    for (const union of analysis.unions) {
      if (union.kind === 'overlap' || union.kind === 'mixed') continue;
      const isValley = union.kind === 'valley';
      const attrs = {
        x1: union.a.x,
        y1: union.a.y,
        x2: union.b.x,
        y2: union.b.y,
        class: isValley ? 'union-valley' : 'union-high',
      };
      if (!isValley) attrs['vector-effect'] = 'non-scaling-stroke';
      const line = svgEl('line', attrs);
      if (isValley) {
        // El trazo discontinuo se mantiene en píxeles al hacer zoom.
        line.style.strokeWidth = String(2.1 / k);
        line.style.strokeDasharray = `${7 / k} ${4 / k}`;
      }
      els.unionLayer.appendChild(line);
    }
  }

  function representativePoint(points) {
    const center = G.centroid(points);
    if (G.pointInPolygon(center, points)) return center;
    const b = G.bounds(points);
    if (!b) return center;
    for (let iy = 1; iy < 14; iy++) {
      for (let ix = 1; ix < 14; ix++) {
        const p = {
          x: b.minX + (b.width * ix) / 14,
          y: b.minY + (b.height * iy) / 14,
        };
        if (G.pointInPolygon(p, points)) return p;
      }
    }
    return center;
  }

  function planLabel(name) {
    const stripped =
      String(name).replace(/^Principal\s+/i, '').replace(/^Ala\s+/i, '').trim() || String(name);
    return stripped.charAt(0).toUpperCase() + stripped.slice(1);
  }

  function renderPlanLabels() {
    const k = state.ui.view.k;
    const labelPx = clamp((els.planWrap.clientWidth || 700) / 70, 9, 11.5);
    const labelSize = labelPx / k;
    const halo = Math.max(2.6, labelPx * 0.29) / k;

    for (const item of analysis.panos) {
      if (item.metrics.areaPlan < 0.45) continue;
      const p = representativePoint(item.pano.points);
      const d = item.metrics.d;
      const lx = p.x - d.x * 0.38;
      const ly = p.y - d.y * 0.38;
      const text = svgEl('text', {
        x: lx,
        y: ly,
        class: 'pano-label',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-size': labelSize,
        stroke: '#fffdf9',
        'stroke-width': halo,
      });
      const prefix = item.pano.id === state.roof.principalId ? '★ ' : '';
      text.textContent = `${prefix}${planLabel(item.pano.name)}`;
      els.labelLayer.appendChild(text);

      const selected = item.pano.id === state.ui.selectedId;
      const len = clamp(Math.sqrt(item.metrics.areaPlan) * 0.2, 0.42, 0.85);
      const start = { x: p.x - d.x * len * 0.2, y: p.y - d.y * len * 0.2 };
      const end = { x: p.x + d.x * len * 0.8, y: p.y + d.y * len * 0.8 };
      const normal = { x: -d.y, y: d.x };
      const group = svgEl('g', {
        class: 'pano-arrow',
        opacity: selected ? '0.92' : '0.5',
      });
      const shaft = svgEl('line', {
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        'vector-effect': 'non-scaling-stroke',
      });
      const head = svgEl('path', {
        d: `M ${end.x} ${end.y} L ${end.x - d.x * 0.28 + normal.x * 0.15} ${end.y - d.y * 0.28 + normal.y * 0.15} L ${end.x - d.x * 0.28 - normal.x * 0.15} ${end.y - d.y * 0.28 - normal.y * 0.15} Z`,
      });
      const dot = svgEl('circle', { cx: start.x, cy: start.y, r: 2 / k });
      group.append(shaft, head, dot);
      els.labelLayer.appendChild(group);
    }

    if (analysis.panos.length) {
      let highest = null;
      for (const item of analysis.panos) {
        for (const p of item.pano.points) {
          const z = G.pointHeight(p, item.metrics);
          if (!highest || z > highest.z) highest = { x: p.x, y: p.y, z };
        }
      }
      if (highest) {
        const tag = svgEl('text', {
          x: highest.x,
          y: highest.y - 14 / k,
          class: 'height-text',
          'text-anchor': 'middle',
          'dominant-baseline': 'middle',
          'font-size': 9.5 / k,
          stroke: '#fffdf9',
          'stroke-width': 3 / k,
        });
        tag.textContent = `▲ ${fmtM(highest.z, 2)}`;
        els.labelLayer.appendChild(tag);
      }
    }
  }

  function renderPlanSelection() {
    const pano = selectedPano();
    if (!pano) return;
    const k = state.ui.view.k;
    const outline = svgEl('path', {
      d: pathData(pano.points),
      class: 'selected-outline',
    });
    outline.style.strokeWidth = String(1.8 / k);
    outline.style.strokeDasharray = `${5 / k} ${4 / k}`;
    els.labelLayer.appendChild(outline);

    pano.points.forEach((point, index) => {
      const shared = state.roof.panos.some(
        (other) => other.id !== pano.id && other.points.some((p) => G.distance(p, point) < 1e-6)
      );
      const group = svgEl('g', {
        class: 'vertex-handle',
        'data-pano-id': pano.id,
        'data-index': String(index),
      });
      const hit = svgEl('circle', {
        cx: point.x,
        cy: point.y,
        r: 12 / k,
        class: 'vertex-hit',
      });
      const visible = svgEl('circle', {
        cx: point.x,
        cy: point.y,
        r: shared ? 4.8 / k : 4.2 / k,
        class: `vertex-visible${shared ? ' vertex-shared' : ''}`,
      });
      group.append(hit, visible);
      group.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginVertexDrag(pano.id, index, event);
      });
      els.labelLayer.appendChild(group);
    });
  }

  function renderPlanDimensions() {
    const b = analysis.bbox;
    if (!b) return;
    const k = state.ui.view.k;
    const fs = 9.5 / k;
    const dimY = b.maxY + 0.85;
    const dimX = b.minX - 0.85;
    const addLine = (x1v, y1v, x2v, y2v) => {
      els.labelLayer.appendChild(
        svgEl('line', {
          x1: x1v,
          y1: y1v,
          x2: x2v,
          y2: y2v,
          class: 'dim-line',
          'vector-effect': 'non-scaling-stroke',
        })
      );
    };
    addLine(b.minX, b.maxY, b.minX, dimY);
    addLine(b.maxX, b.maxY, b.maxX, dimY);
    addLine(b.minX, dimY, b.maxX, dimY);
    addLine(b.minX, dimY - 0.1, b.minX, dimY + 0.1);
    addLine(b.maxX, dimY - 0.1, b.maxX, dimY + 0.1);
    const widthText = svgEl('text', {
      x: (b.minX + b.maxX) / 2,
      y: dimY - 8 / k,
      class: 'dim-text',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-size': fs,
      stroke: '#fffdf9',
      'stroke-width': 2.6 / k,
    });
    widthText.textContent = fmtM(b.width, 2);
    els.labelLayer.appendChild(widthText);

    addLine(b.minX, b.minY, dimX, b.minY);
    addLine(b.minX, b.maxY, dimX, b.maxY);
    addLine(dimX, b.minY, dimX, b.maxY);
    addLine(dimX - 0.1, b.minY, dimX + 0.1, b.minY);
    addLine(dimX - 0.1, b.maxY, dimX + 0.1, b.maxY);
    const heightText = svgEl('text', {
      x: dimX - 8 / k,
      y: (b.minY + b.maxY) / 2,
      class: 'dim-text',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-size': fs,
      stroke: '#fffdf9',
      'stroke-width': 2.6 / k,
      transform: `rotate(-90 ${dimX - 8 / k} ${(b.minY + b.maxY) / 2})`,
    });
    heightText.textContent = fmtM(b.height, 2);
    els.labelLayer.appendChild(heightText);
  }

  function updateScaleBar() {
    const k = state.ui.view.k;
    const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
    let best = candidates[0];
    let diff = Infinity;
    for (const candidate of candidates) {
      const px = candidate * k;
      const d = Math.abs(px - 80);
      if (d < diff) {
        diff = d;
        best = candidate;
      }
    }
    const px = Math.max(18, best * k);
    els.scaleBar.style.width = `${px}px`;
    els.scaleLabel.textContent = best < 1 ? `${fmt(best, 2)} m` : `${fmt(best, 0)} m`;
  }

  function updateDrawPreview() {
    if (!els.drawLayer) return;
    els.drawLayer.replaceChildren();
    const draw = state.ui.draw;
    if (!draw) return;
    const k = state.ui.view.k;
    const points = draw.points;
    const cursor = state.ui.cursorWorld;
    const dash = `${6 / k} ${4 / k}`;

    if (points.length >= 2) {
      const line = svgEl('path', {
        d: pathData(points, false),
        class: 'draw-line',
        'vector-effect': 'non-scaling-stroke',
      });
      els.drawLayer.appendChild(line);
    }
    if (cursor) {
      const last = points[points.length - 1];
      const addCloseLine = (x1, y1, x2, y2) => {
        const line = svgEl('line', {
          x1,
          y1,
          x2,
          y2,
          class: 'draw-close',
        });
        line.style.strokeWidth = String(1.4 / k);
        line.style.strokeDasharray = dash;
        els.drawLayer.appendChild(line);
      };
      if (last) addCloseLine(last.x, last.y, cursor.x, cursor.y);
      if (points.length >= 2) {
        addCloseLine(cursor.x, cursor.y, points[0].x, points[0].y);
      }
      const closeToFirst = points.length >= 3 && G.distance(cursor, points[0]) < 1e-6;
      if (closeToFirst) {
        const ring = svgEl('circle', {
          cx: points[0].x,
          cy: points[0].y,
          r: 9 / k,
          class: 'draw-snap',
        });
        ring.style.strokeWidth = String(1.4 / k);
        ring.style.strokeDasharray = `${3 / k} ${2 / k}`;
        els.drawLayer.appendChild(ring);
      }
      const cursorCircle = svgEl('circle', {
        cx: cursor.x,
        cy: cursor.y,
        r: 3 / k,
        class: 'draw-snap',
      });
      cursorCircle.style.strokeWidth = String(1.4 / k);
      els.drawLayer.appendChild(cursorCircle);
    }
    points.forEach((point, index) => {
      els.drawLayer.appendChild(
        svgEl('circle', {
          cx: point.x,
          cy: point.y,
          r: (index === 0 ? 5 : 3.6) / k,
          class: index === 0 ? 'draw-point-first' : 'draw-point',
        })
      );
    });
  }

  function snapPoint(raw, options) {
    const opts = options || {};
    const k = state.ui.view.k;
    const exclude = opts.exclude || new Set();
    const extra = opts.extraPoints || [];
    let best = null;

    const consider = (p, type, threshold, key) => {
      if (key && exclude.has(key)) return;
      const distance = Math.hypot((p.x - raw.x) * k, (p.y - raw.y) * k);
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { x: p.x, y: p.y, type, distance };
      }
    };

    for (const pano of state.roof.panos) {
      pano.points.forEach((point, index) => {
        consider(point, 'vertex', 11, `${pano.id}:${index}`);
      });
    }
    extra.forEach((point) => consider(point, 'vertex', 11));

    if (!best && opts.allowEdges !== false) {
      for (const pano of state.roof.panos) {
        const points = pano.points;
        for (let i = 0; i < points.length; i++) {
          const closest = G.closestPointOnSegment(raw, points[i], points[(i + 1) % points.length]);
          const distance = Math.hypot((closest.x - raw.x) * k, (closest.y - raw.y) * k);
          if (distance <= 9 && (!best || distance < best.distance)) {
            best = { x: closest.x, y: closest.y, type: 'edge', distance };
          }
        }
      }
    }

    if (best) return { x: best.x, y: best.y, type: best.type };
    if (opts.free) return { x: raw.x, y: raw.y, type: 'free' };
    const step = 0.1;
    return {
      x: G.round(Math.round(raw.x / step) * step, 3),
      y: G.round(Math.round(raw.y / step) * step, 3),
      type: 'grid',
    };
  }

  function panoAt(point) {
    const panos = state.roof.panos;
    for (let i = panos.length - 1; i >= 0; i--) {
      if (G.pointInPolygon(point, panos[i].points)) return panos[i];
    }
    return null;
  }

  function updateCursorReadout(point) {
    if (!point) {
      els.cursorReadout.textContent = '— · — m';
      return;
    }
    els.cursorReadout.textContent = `${fmt(point.x, 2)} · ${fmt(point.y, 2)} m`;
  }

  function beginVertexDrag(panoId, index, event) {
    const pano = state.roof.panos.find((p) => p.id === panoId);
    if (!pano) return;
    const start = { x: pano.points[index].x, y: pano.points[index].y };
    const shared = [];
    const exclude = new Set();
    for (const other of state.roof.panos) {
      other.points.forEach((point, pointIndex) => {
        if (G.distance(point, start) < 1e-6) {
          shared.push({ pano: other, index: pointIndex });
          exclude.add(`${other.id}:${pointIndex}`);
        }
      });
    }
    pointerState = {
      mode: 'vertex',
      panoId,
      index,
      start,
      shared,
      exclude,
      before: snapshot(),
      moved: false,
      pointerId: event.pointerId,
    };
    try {
      els.planSvg.setPointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
  }

  function handlePlanPointerDown(event) {
    if (state.ui.tool === 'draw') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (pointerState) return;
    pointerState = {
      mode: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      startTx: state.ui.view.tx,
      startTy: state.ui.view.ty,
      moved: false,
      pointerId: event.pointerId,
    };
    try {
      els.planSvg.setPointerCapture(event.pointerId);
    } catch (error) {
      /* ignore */
    }
  }

  function handlePlanPointerMove(event) {
    const point = svgPointFromEvent(event);
    if (state.ui.tool === 'draw') {
      const snapped = snapPoint(point);
      state.ui.cursorWorld = { x: snapped.x, y: snapped.y };
      updateCursorReadout(snapped);
      updateDrawPreview();
      return;
    }
    if (pointerState && pointerState.mode === 'vertex') {
      const snapped = snapPoint(point, {
        exclude: pointerState.exclude,
        allowEdges: false,
      });
      updateCursorReadout(snapped);
      const changed =
        snapped.x !== pointerState.start.x || snapped.y !== pointerState.start.y;
      if (!changed) return;
      for (const shared of pointerState.shared) {
        shared.pano.points[shared.index].x = snapped.x;
        shared.pano.points[shared.index].y = snapped.y;
      }
      pointerState.start = { x: snapped.x, y: snapped.y };
      pointerState.moved = true;
      render();
      return;
    }
    if (pointerState && pointerState.mode === 'pan') {
      const dx = event.clientX - pointerState.startX;
      const dy = event.clientY - pointerState.startY;
      if (!pointerState.moved && Math.hypot(dx, dy) < 3) return;
      pointerState.moved = true;
      els.planSvg.classList.add('is-panning');
      state.ui.view.tx = pointerState.startTx + dx;
      state.ui.view.ty = pointerState.startTy + dy;
      els.planWorld.setAttribute(
        'transform',
        `translate(${state.ui.view.tx} ${state.ui.view.ty}) scale(${state.ui.view.k})`
      );
      renderPlan();
      return;
    }
    updateCursorReadout(point);
  }

  function handlePlanPointerUp(event) {
    if (!pointerState) return;
    if (pointerState.mode === 'vertex') {
      if (pointerState.moved) {
        commitBefore(pointerState.before);
        render();
      }
      pointerState = null;
      try {
        els.planSvg.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
      return;
    }
    if (pointerState.mode === 'pan') {
      const moved = pointerState.moved;
      pointerState = null;
      els.planSvg.classList.remove('is-panning');
      try {
        els.planSvg.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
      if (!moved) {
        const point = svgPointFromEvent(event);
        const pano = panoAt(point);
        selectPano(pano ? pano.id : null);
      }
    }
  }

  function handlePlanPointerCancel() {
    if (pointerState && pointerState.mode === 'pan') {
      els.planSvg.classList.remove('is-panning');
    }
    pointerState = null;
  }

  function handlePlanLeave() {
    if (pointerState) return;
    updateCursorReadout(null);
    if (state.ui.draw) {
      state.ui.cursorWorld = null;
      updateDrawPreview();
    }
  }

  function handlePlanClick(event) {
    if (state.ui.tool !== 'draw' || !state.ui.draw) return;
    if (event.detail > 1) return;
    const point = svgPointFromEvent(event);
    const snapped = snapPoint(point, { extraPoints: state.ui.draw.points });
    const draw = state.ui.draw;
    if (draw.points.length >= 3 && G.distance(snapped, draw.points[0]) < 1e-6) {
      finishDraw();
      return;
    }
    const last = draw.points[draw.points.length - 1];
    if (last && G.distance(last, snapped) < 1e-6) return;
    draw.points.push({ x: snapped.x, y: snapped.y });
    state.ui.cursorWorld = { x: snapped.x, y: snapped.y };
    updateDrawHint();
    updateDrawPreview();
    updateCursorReadout(snapped);
  }

  /* ------------------------------------------------------------------ */
  /* Dial de dirección                                                  */
  /* ------------------------------------------------------------------ */

  function bindDial() {
    const dial = els.dialSvg;
    let dialPointer = null;
    const applyDirection = (event) => {
      const pano = selectedPano();
      if (!pano) return;
      const rect = dial.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      if (Math.hypot(dx, dy) < 4) return;
      const angle = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360) % 360;
      if (pano.direction === angle) return;
      pano.direction = angle;
      render();
    };
    dial.addEventListener('pointerdown', (event) => {
      if (!selectedPano()) return;
      event.preventDefault();
      dialPointer = { before: snapshot(), pointerId: event.pointerId };
      dial.classList.add('is-dialing');
      try {
        dial.setPointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
      applyDirection(event);
    });
    dial.addEventListener('pointermove', (event) => {
      if (!dialPointer) return;
      applyDirection(event);
    });
    const end = (event) => {
      if (!dialPointer) return;
      dial.classList.remove('is-dialing');
      commitBefore(dialPointer.before);
      dialPointer = null;
      try {
        dial.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
    };
    dial.addEventListener('pointerup', end);
    dial.addEventListener('pointercancel', end);
  }

  /* ------------------------------------------------------------------ */
  /* Vista 3D                                                           */
  /* ------------------------------------------------------------------ */

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }

  function shadeColor(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const adjust = (value) => clamp(Math.round(value + amount * 255), 0, 255);
    return `rgb(${adjust(r)}, ${adjust(g)}, ${adjust(b)})`;
  }

  function normalize3(v) {
    const length = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  }

  function roundRectPath(ctx, x, y, w, h, radius) {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function seamIntervals(points, axis, slopeAxis, value) {
    const crossings = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const fa = a.x * axis.x + a.y * axis.y - value;
      const fb = b.x * axis.x + b.y * axis.y - value;
      if (Math.abs(fa) < 1e-9) crossings.push(a.x * slopeAxis.x + a.y * slopeAxis.y);
      if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
        const t = fa / (fa - fb);
        crossings.push(
          (a.x + (b.x - a.x) * t) * slopeAxis.x +
            (a.y + (b.y - a.y) * t) * slopeAxis.y
        );
      }
    }
    const unique = [];
    for (const valueS of crossings.sort((a, b) => a - b)) {
      if (!unique.length || Math.abs(unique[unique.length - 1] - valueS) > 1e-5) {
        unique.push(valueS);
      }
    }
    const intervals = [];
    for (let i = 0; i + 1 < unique.length; i += 2) {
      if (unique[i + 1] - unique[i] > 0.03) {
        intervals.push([unique[i], unique[i + 1]]);
      }
    }
    return intervals;
  }

  function draw3D() {
    if (!els.view3d || !els.view3dWrap) return;
    const wrap = els.view3dWrap;
    const canvas = els.view3d;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 20 || h < 20) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const panos = analysis ? analysis.panos : [];
    els.view3dEmpty.hidden = panos.length > 0;
    if (!panos.length) return;

    const b = analysis.bbox;
    const maxZ = analysis.maxHeight;
    const center = {
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2,
      z: maxZ / 2,
    };
    const orbit = state.ui.orbit;
    const az = (orbit.az * Math.PI) / 180;
    const el = (orbit.el * Math.PI) / 180;
    const cosAz = Math.cos(az);
    const sinAz = Math.sin(az);
    const sinEl = Math.sin(el);
    const cosEl = Math.cos(el);

    const rawProject = (x, y, z) => {
      const dx = x - center.x;
      const dy = y - center.y;
      const dz = z - center.z;
      const px = dx * cosAz - dy * sinAz;
      const py = dx * sinAz + dy * cosAz;
      return {
        x: px,
        y: py * sinEl - dz * cosEl,
        depth: py * cosEl + dz * sinEl,
      };
    };

    const extents = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const include = (raw) => {
      if (raw.x < extents.minX) extents.minX = raw.x;
      if (raw.x > extents.maxX) extents.maxX = raw.x;
      if (raw.y < extents.minY) extents.minY = raw.y;
      if (raw.y > extents.maxY) extents.maxY = raw.y;
    };

    const padWorld = 1.25;
    const gx0 = b.minX - padWorld;
    const gx1 = b.maxX + padWorld;
    const gy0 = b.minY - padWorld;
    const gy1 = b.maxY + padWorld;
    include(rawProject(gx0, gy0, 0));
    include(rawProject(gx0, gy1, 0));
    include(rawProject(gx1, gy0, 0));
    include(rawProject(gx1, gy1, 0));

    const planes = panos.map((item) => {
      const projected = item.pano.points.map((p) => {
        const z = G.pointHeight(p, item.metrics);
        const raw = rawProject(p.x, p.y, z);
        include(raw);
        return { point: p, z, raw };
      });
      for (const p of item.pano.points) include(rawProject(p.x, p.y, 0));
      const depth = projected.reduce((sum, p) => sum + p.raw.depth, 0) / projected.length;
      return { item, projected, depth };
    });

    let highest = null;
    for (const item of panos) {
      for (const p of item.pano.points) {
        const z = G.pointHeight(p, item.metrics);
        if (!highest || z > highest.z) highest = { x: p.x, y: p.y, z };
      }
    }
    if (highest) include(rawProject(highest.x, highest.y, highest.z));

    const padPx = 28;
    const rangeX = Math.max(0.001, extents.maxX - extents.minX);
    const rangeY = Math.max(0.001, extents.maxY - extents.minY);
    const scale =
      Math.min((w - padPx * 2) / rangeX, (h - padPx * 2) / rangeY) * orbit.zoom;
    const midX = (extents.minX + extents.maxX) / 2;
    const midY = (extents.minY + extents.maxY) / 2;
    const toScreen = (raw) => ({
      x: w / 2 + (raw.x - midX) * scale,
      y: h / 2 + (raw.y - midY) * scale,
      depth: raw.depth,
    });
    const project = (x, y, z) => toScreen(rawProject(x, y, z));

    // Sombra de la techumbre sobre el suelo.
    ctx.fillStyle = 'rgba(38, 33, 26, 0.055)';
    for (const item of panos) {
      const pts = item.pano.points.map((p) => project(p.x, p.y, 0));
      ctx.beginPath();
      pts.forEach((p, index) => {
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
    }

    // Grilla del suelo.
    const maxDim = Math.max(b.width, b.height, 8);
    let gridStep = 1;
    while (maxDim / gridStep > 26) {
      gridStep = gridStep === 1 ? 2 : gridStep === 2 ? 5 : gridStep * 2;
    }
    const gridX0 = Math.floor(gx0 / gridStep) * gridStep;
    const gridY0 = Math.floor(gy0 / gridStep) * gridStep;
    ctx.lineWidth = 1;
    const drawGridLines = (major) => {
      ctx.beginPath();
      for (let x = gridX0; x <= gx1; x += gridStep) {
        const isMajor = Math.abs(x / (gridStep * 5) - Math.round(x / (gridStep * 5))) < 1e-6;
        if (isMajor !== major) continue;
        const a = project(x, gy0, 0);
        const c = project(x, gy1, 0);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
      }
      for (let y = gridY0; y <= gy1; y += gridStep) {
        const isMajor = Math.abs(y / (gridStep * 5) - Math.round(y / (gridStep * 5))) < 1e-6;
        if (isMajor !== major) continue;
        const a = project(gx0, y, 0);
        const c = project(gx1, y, 0);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
      }
      ctx.strokeStyle = major ? 'rgba(94, 88, 76, 0.18)' : 'rgba(94, 88, 76, 0.09)';
      ctx.stroke();
    };
    drawGridLines(false);
    drawGridLines(true);

    const light = normalize3({ x: -0.38, y: -0.56, z: 0.78 });
    const sorted = [...planes].sort((a, b2) => a.depth - b2.depth);

    for (const plane of sorted) {
      const { item, projected } = plane;
      const pano = item.pano;
      const selected = pano.id === state.ui.selectedId;
      const m = item.metrics;
      const normal = normalize3({ x: m.tan * m.d.x, y: m.tan * m.d.y, z: 1 });
      const lightDot = clamp(
        normal.x * light.x + normal.y * light.y + normal.z * light.z,
        0,
        1
      );
      const amount = (lightDot - 0.72) * 0.62;
      const fill = shadeColor(pano.color, amount);
      const screenPoints = projected.map((p) => toScreen(p.raw));

      ctx.beginPath();
      screenPoints.forEach((p, index) => {
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      if (state.ui.sheets3d && item.layout.columns > 0 && item.layout.columns < 80) {
        ctx.save();
        ctx.beginPath();
        screenPoints.forEach((p, index) => {
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
        ctx.clip();
        ctx.strokeStyle = 'rgba(36, 31, 24, 0.18)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let j = 1; j < item.layout.columns; j++) {
          const t = m.tMin + j * item.layout.anchoUtil;
          const intervals = seamIntervals(pano.points, m.t, m.d, t);
          for (const interval of intervals) {
            const p1 = {
              x: interval[0] * m.d.x + t * m.t.x,
              y: interval[0] * m.d.y + t * m.t.y,
              z: m.eaveHeight + (m.sMax - interval[0]) * m.tan,
            };
            const p2 = {
              x: interval[1] * m.d.x + t * m.t.x,
              y: interval[1] * m.d.y + t * m.t.y,
              z: m.eaveHeight + (m.sMax - interval[1]) * m.tan,
            };
            const a = project(p1.x, p1.y, p1.z);
            const b2 = project(p2.x, p2.y, p2.z);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b2.x, b2.y);
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      screenPoints.forEach((p, index) => {
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.strokeStyle = selected ? '#b34e32' : 'rgba(45, 46, 38, 0.32)';
      ctx.lineWidth = selected ? 2.2 : 1;
      ctx.stroke();
    }

    // Uniones dibujadas sobre la techumbre.
    const metricsById = new Map(analysis.panos.map((item) => [item.pano.id, item.metrics]));
    for (const union of analysis.unions) {
      if (union.kind === 'overlap' || union.kind === 'mixed') continue;
      const unionMetrics = metricsById.get(union.panoA.id);
      if (!unionMetrics) continue;
      const zA = G.pointHeight(union.a, unionMetrics);
      const zB = G.pointHeight(union.b, unionMetrics);
      const a = project(union.a.x, union.a.y, zA);
      const b2 = project(union.b.x, union.b.y, zB);
      if (union.kind === 'valley') {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.strokeStyle = 'rgba(24, 32, 34, 0.3)';
        ctx.lineWidth = 3.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.strokeStyle = '#2f6c8e';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.strokeStyle = 'rgba(38, 34, 27, 0.22)';
        ctx.lineWidth = 4.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.strokeStyle = '#f4e8d4';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Poste de altura.
    if (highest) {
      const ground = project(highest.x, highest.y, 0);
      const top = project(highest.x, highest.y, highest.z);
      const eave = project(highest.x, highest.y, state.roof.eaveHeight);
      ctx.beginPath();
      ctx.moveTo(ground.x, ground.y);
      ctx.lineTo(top.x, top.y);
      ctx.strokeStyle = 'rgba(48, 53, 44, 0.42)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(48, 53, 44, 0.55)';
      ctx.lineWidth = 1;
      [eave, top].forEach((p) => {
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y);
        ctx.lineTo(p.x + 5, p.y);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.arc(ground.x, ground.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(48, 53, 44, 0.5)';
      ctx.fill();

      const makePill = (text, x, y, opts) => {
        ctx.font = '600 9.5px "Segoe UI", system-ui, sans-serif';
        const padX = 7;
        const height = 17;
        const textWidth = ctx.measureText(text).width;
        const width = textWidth + padX * 2;
        const left = clamp(x, 4, w - width - 4);
        const topY = clamp(y, 4, h - height - 4);
        roundRectPath(ctx, left, topY, width, height, 6);
        ctx.fillStyle = opts && opts.background ? opts.background : 'rgba(255, 253, 249, 0.94)';
        ctx.fill();
        ctx.strokeStyle = opts && opts.border ? opts.border : 'rgba(70, 64, 52, 0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = opts && opts.color ? opts.color : '#3d443c';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, left + padX, topY + height / 2 + 0.5);
        return { left, top: topY, width, height };
      };
      makePill(`Cumbrera máx. ${fmtM(highest.z, 2)}`, top.x + 10, top.y - 10, {
        color: '#8d4a33',
        border: 'rgba(141, 74, 51, 0.22)',
      });
      let eaveLabelY = eave.y - 10;
      if (Math.abs(eaveLabelY - (top.y - 10)) < 23) eaveLabelY = top.y + 20;
      makePill(`Alero ${fmtM(state.roof.eaveHeight, 2)}`, eave.x + 10, eaveLabelY);
    }

    // Etiquetas de las aguas.
    if (state.ui.labels3d) {
      const labels = panos.map((item) => {
        const point = representativePoint(item.pano.points);
        const z = G.pointHeight(point, item.metrics);
        const raw = rawProject(point.x, point.y, z);
        return { item, screen: toScreen(raw), depth: raw.depth };
      });
      labels.sort((a, b2) => a.depth - b2.depth);
      for (const label of labels) {
        const pano = label.item.pano;
        const selected = pano.id === state.ui.selectedId;
        const displayName =
          pano.id === state.roof.principalId
            ? `★ ${planLabel(pano.name)}`
            : planLabel(pano.name);
        ctx.font = '600 9.5px "Segoe UI", system-ui, sans-serif';
        const textWidth = ctx.measureText(displayName).width;
        const padX = 6;
        const height = 17;
        const dot = 5;
        const gap = 5;
        const width = padX * 2 + dot + gap + textWidth;
        const left = clamp(label.screen.x - width / 2, 4, w - width - 4);
        const topY = clamp(label.screen.y - height - 7, 4, h - height - 4);
        roundRectPath(ctx, left, topY, width, height, 6);
        ctx.fillStyle = 'rgba(255, 253, 249, 0.94)';
        ctx.fill();
        ctx.strokeStyle = selected ? 'rgba(194, 99, 74, 0.75)' : 'rgba(66, 60, 48, 0.14)';
        ctx.lineWidth = selected ? 1.4 : 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(left + padX + dot / 2, topY + height / 2, dot / 2, 0, Math.PI * 2);
        ctx.fillStyle = pano.color;
        ctx.fill();
        ctx.fillStyle = '#242a23';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayName, left + padX + dot + gap, topY + height / 2 + 0.5);
      }
    }
  }

  function bind3D() {
    const wrap = els.view3dWrap;
    const canvas = els.view3d;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      drag3d = {
        x: event.clientX,
        y: event.clientY,
        az: state.ui.orbit.az,
        el: state.ui.orbit.el,
        pointerId: event.pointerId,
      };
      wrap.classList.add('is-dragging');
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag3d) return;
      const dx = event.clientX - drag3d.x;
      const dy = event.clientY - drag3d.y;
      state.ui.orbit.az = (drag3d.az + dx * 0.35) % 360;
      state.ui.orbit.el = clamp(drag3d.el - dy * 0.28, 8, 82);
      draw3D();
    });
    const end = (event) => {
      if (!drag3d) return;
      drag3d = null;
      wrap.classList.remove('is-dragging');
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        state.ui.orbit.zoom = clamp(
          state.ui.orbit.zoom * (event.deltaY < 0 ? 1.08 : 0.93),
          0.55,
          2.8
        );
        draw3D();
      },
      { passive: false }
    );
  }

  /* ------------------------------------------------------------------ */
  /* Exportación                                                        */
  /* ------------------------------------------------------------------ */

  function csvField(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    if (!analysis.panos.length) {
      toast('No hay aguas para exportar', 'error');
      return;
    }
    const t = analysis.totals;
    const principal = principalPano();
    const principalInfo = principalItem();
    const rows = [];
    rows.push(['Cumbrera — cálculo de planchas', '']);
    rows.push(['Fecha', new Date().toLocaleDateString('es-CL')]);
    rows.push(['Agua principal', principal ? principal.name : '—']);
    rows.push(['Pendiente principal (%)', principal ? fmt(principal.pitch, 1) : fmt(state.roof.pitch, 1)]);
    rows.push(['Altura de alero (m)', fmt(state.roof.eaveHeight, 2)]);
    rows.push([
      'Cumbrera principal (m)',
      principalInfo ? fmt(principalInfo.metrics.maxHeight, 2) : '—',
    ]);
    rows.push(['Cumbrera máxima (m)', fmt(analysis.maxHeight, 2)]);
    rows.push([`Plancha ${fmt(state.sheet.width, 2)} m (útil ${fmt(usableWidth(), 2)} m)`, '']);
    rows.push(['Traslape lateral (m)', fmt(state.sheet.lateralOverlap, 2)]);
    rows.push(['Largo máximo (m)', fmt(state.sheet.maxLength, 2)]);
    rows.push(['Redondeo de largo (m)', fmt(state.sheet.lengthStep, 2)]);
    rows.push(['Traslape longitudinal (m)', fmt(state.sheet.longitudinalOverlap, 2)]);
    rows.push(['Margen de corte (m)', fmt(state.sheet.endAllowance, 2)]);
    rows.push([]);
    rows.push([
      'Agua', 'Principal', 'Dirección', 'Superficie (m²)', 'Pendiente (%)',
      'Columnas', 'Planchas', 'Metros lineales (m)', 'Largo máximo (m)',
    ]);
    for (const item of analysis.panos) {
      rows.push([
        item.pano.name,
        item.pano.id === state.roof.principalId ? 'Sí' : '',
        G.directionLabel(item.pano.direction),
        fmt(item.metrics.areaRoof, 1),
        fmt(item.metrics.pitch, 1),
        item.layout.columns,
        item.layout.sheetCount,
        fmt(item.layout.linear, 1),
        item.layout.maxPiece ? fmt(item.layout.maxPiece, 2) : '—',
      ]);
    }
    rows.push([
      'Total',
      '',
      '',
      fmt(t.roofArea, 1),
      '',
      '',
      t.sheets,
      fmt(t.linear, 1),
      '',
    ]);
    rows.push([]);
    rows.push(['Uniones de aguas', 'Metros lineales']);
    rows.push(['Cumbrera', fmt(t.byKind.ridge, 1)]);
    rows.push(['Limatesa', fmt(t.byKind.hip, 1)]);
    rows.push(['Limahoya', fmt(t.byKind.valley, 1)]);
    rows.push([]);
    rows.push(['Largos a pedir', 'Cantidad']);
    const cuts = [...t.lengthCounts.values()].sort((a, b) => b.length - a.length);
    for (const cut of cuts) rows.push([fmt(cut.length, 2), cut.count]);
    rows.push([]);
    rows.push(['Superficie comprada (m²)', fmt(t.purchasedArea, 1)]);
    rows.push(['Desperdicio (%)', fmt(t.wastePct * 100, 0)]);
    const csv = '\uFEFF' + rows.map((row) => row.map(csvField).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
    ].join('');
    link.href = url;
    link.download = `cumbrera-planchas-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV exportado');
  }

  /* ------------------------------------------------------------------ */
  /* Utilidades de entrada                                              */
  /* ------------------------------------------------------------------ */

  function bindNumber(input, apply, options) {
    if (!input) return;
    const opts = options || {};
    let before = null;
    input.addEventListener('focus', () => {
      before = snapshot();
    });
    input.addEventListener('input', () => {
      const value = readNumber(input);
      if (value == null) return;
      apply(clamp(value, opts.min == null ? -Infinity : opts.min, opts.max == null ? Infinity : opts.max));
      render();
    });
    input.addEventListener('change', () => {
      const value = readNumber(input);
      if (value == null) {
        render();
        return;
      }
      apply(clamp(value, opts.min == null ? -Infinity : opts.min, opts.max == null ? Infinity : opts.max));
      render();
      if (before) {
        commitBefore(before);
        before = snapshot();
      }
    });
    input.addEventListener('blur', () => {
      if (before) {
        commitBefore(before);
        before = null;
        render();
      }
    });
  }

  function bindNameInput() {
    let before = null;
    els.panoName.addEventListener('focus', () => {
      before = snapshot();
    });
    els.panoName.addEventListener('input', () => {
      const pano = selectedPano();
      if (!pano) return;
      pano.name = els.panoName.value.slice(0, 40);
      render();
    });
    const commitName = () => {
      const pano = selectedPano();
      if (!pano) return;
      const trimmed = pano.name.trim();
      pano.name = trimmed || 'Agua';
      if (before) {
        commitBefore(before);
        before = snapshot();
      }
      render();
    };
    els.panoName.addEventListener('change', commitName);
    els.panoName.addEventListener('blur', () => {
      commitName();
      before = null;
    });
  }

  function bindInputs() {
    bindNumber(
      els.pitchInput,
      (value) => {
        const rounded = G.round(value, 1);
        const principal = principalPano();
        if (principal) principal.pitch = rounded;
        state.roof.pitch = rounded;
      },
      { min: 1, max: 120 }
    );
    bindNumber(
      els.panoPitchInput,
      (value) => {
        const pano = selectedPano();
        if (!pano) return;
        pano.pitch = G.round(value, 1);
        if (pano.id === state.roof.principalId) state.roof.pitch = pano.pitch;
      },
      { min: 1, max: 120 }
    );
    bindNumber(
      els.eaveInput,
      (value) => {
        state.roof.eaveHeight = value;
      },
      { min: 0.5, max: 20 }
    );
    bindNumber(
      els.ridgeInput,
      (value) => {
        const principal = principalItem();
        if (!principal || principal.metrics.run < 0.01) return;
        const target = Math.max(state.roof.eaveHeight + 0.05, value);
        const pitch = G.round(
          clamp(
            ((target - state.roof.eaveHeight) / principal.metrics.run) * 100,
            1,
            120
          ),
          1
        );
        principal.pano.pitch = pitch;
        state.roof.pitch = pitch;
      },
      { min: 0.5, max: 30 }
    );
    bindNumber(
      els.sheetWidth,
      (value) => {
        state.sheet.width = value;
      },
      { min: 0.3, max: 3 }
    );
    bindNumber(
      els.sheetOverlap,
      (value) => {
        state.sheet.lateralOverlap = value;
      },
      { min: 0, max: 0.5 }
    );
    bindNumber(
      els.sheetMaxLength,
      (value) => {
        state.sheet.maxLength = value;
      },
      { min: 0.5, max: 20 }
    );
    bindNumber(
      els.sheetStep,
      (value) => {
        state.sheet.lengthStep = value;
      },
      { min: 0.01, max: 1 }
    );
    bindNumber(
      els.sheetLongOverlap,
      (value) => {
        state.sheet.longitudinalOverlap = value;
      },
      { min: 0, max: 1 }
    );
    bindNumber(
      els.sheetMargin,
      (value) => {
        state.sheet.endAllowance = value;
      },
      { min: 0, max: 1 }
    );
    bindNumber(
      els.directionInput,
      (value) => {
        const pano = selectedPano();
        if (pano) pano.direction = ((Math.round(value) % 360) + 360) % 360;
      },
      { min: 0, max: 360 }
    );
    bindNameInput();

    els.panoPrincipalBtn.addEventListener('click', setSelectedAsPrincipal);
    els.autoPitchesBtn.addEventListener('click', autoAlignSecondaryPitches);

    els.sheetPreset.addEventListener('change', () => {
      const id = els.sheetPreset.value;
      if (id === 'custom' || !PRESETS[id]) return;
      pushHistory();
      state.sheet = { ...PRESETS[id] };
      render();
      toast(`Plancha: ${id === 'zinc' ? 'zinc liso 0,8 m' : 'ondulada 1,0 m'}`);
    });

    els.panoDelete.addEventListener('click', deleteSelected);
  }

  function bindToolbar() {
    els.selectTool.addEventListener('click', () => setTool('select'));
    els.drawTool.addEventListener('click', () => setTool('draw'));
    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);
    els.zoomInBtn.addEventListener('click', () => {
      zoomPlanAt(1.2, els.planWrap.clientWidth / 2, els.planWrap.clientHeight / 2);
    });
    els.zoomOutBtn.addEventListener('click', () => {
      zoomPlanAt(1 / 1.2, els.planWrap.clientWidth / 2, els.planWrap.clientHeight / 2);
    });
    els.fitBtn.addEventListener('click', () => {
      fitPlan();
      renderPlan();
    });
    els.drawCloseBtn.addEventListener('click', finishDraw);
    els.drawCancelBtn.addEventListener('click', () => cancelDraw(true));
    els.emptyDrawBtn.addEventListener('click', () => setTool('draw'));

    els.helpBtn.addEventListener('click', openHelp);
    els.helpClose.addEventListener('click', () => els.helpDialog.close());
    els.helpOk.addEventListener('click', () => els.helpDialog.close());
    els.methodBtn.addEventListener('click', openHelp);
    els.helpDialog.addEventListener('click', (event) => {
      if (event.target === els.helpDialog) els.helpDialog.close();
    });
    els.exportBtn.addEventListener('click', exportCsv);
    els.resetBtn.addEventListener('click', resetAll);

    els.labels3d.addEventListener('change', () => {
      state.ui.labels3d = els.labels3d.checked;
      draw3D();
      scheduleSave();
    });
    els.showSheets3d.addEventListener('change', () => {
      state.ui.sheets3d = els.showSheets3d.checked;
      draw3D();
      scheduleSave();
    });
    els.resetViewBtn.addEventListener('click', () => {
      state.ui.orbit = { az: 38, el: 36, zoom: 1 };
      draw3D();
    });
  }

  function bindPlan() {
    const svg = els.planSvg;
    svg.addEventListener('pointerdown', handlePlanPointerDown);
    svg.addEventListener('pointermove', handlePlanPointerMove);
    svg.addEventListener('pointerup', handlePlanPointerUp);
    svg.addEventListener('pointercancel', handlePlanPointerCancel);
    svg.addEventListener('pointerleave', handlePlanLeave);
    svg.addEventListener('click', handlePlanClick);
    svg.addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey) return;
        event.preventDefault();
        const point = svgPointFromEvent(event);
        zoomPlanAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, point.sx, point.sy);
      },
      { passive: false }
    );
    svg.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      if (els.helpDialog.open) return;
      const tag = (event.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || event.target.isContentEditable) {
        if (event.key === 'Escape') event.target.blur();
        return;
      }
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && key === 'z') {
        event.preventDefault();
        if (state.ui.draw) {
          state.ui.draw.points.pop();
          state.ui.cursorWorld = null;
          updateDrawHint();
          updateDrawPreview();
          return;
        }
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (key === 'escape') {
        if (state.ui.draw) cancelDraw(true);
        else if (state.ui.tool === 'draw') setTool('select');
        else if (state.ui.selectedId) {
          state.ui.selectedId = null;
          render();
        }
        return;
      }
      if (key === 'enter' && state.ui.draw) {
        event.preventDefault();
        finishDraw();
        return;
      }
      if ((key === 'backspace' || key === 'delete') && state.ui.draw) {
        event.preventDefault();
        state.ui.draw.points.pop();
        state.ui.cursorWorld = null;
        updateDrawHint();
        updateDrawPreview();
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        if (selectedPano()) deleteSelected();
        return;
      }
      if (key === 'v') setTool('select');
      if (key === 'p' || key === 'd') setTool('draw');
    });
  }

  function openHelp() {
    if (typeof els.helpDialog.showModal === 'function') {
      if (!els.helpDialog.open) els.helpDialog.showModal();
    } else {
      els.helpDialog.setAttribute('open', '');
    }
  }

  function toast(message, type) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.toggle('is-error', type === 'error');
    els.toast.classList.add('is-visible');
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('is-visible');
    }, type === 'error' ? 3800 : 2700);
  }

  /* ------------------------------------------------------------------ */
  /* Plantillas y miniaturas                                            */
  /* ------------------------------------------------------------------ */

  function buildTemplateGrid() {
    els.templateGrid.replaceChildren();
    for (const template of TPL.list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'template-card';
      button.title = `Usar plantilla ${template.name}`;
      const thumb = document.createElement('div');
      thumb.className = 'template-thumb';
      thumb.appendChild(buildTemplateThumb(template));
      const name = document.createElement('span');
      name.className = 'template-name';
      name.textContent = template.name;
      const description = document.createElement('span');
      description.className = 'template-desc';
      description.textContent = template.description;
      button.append(thumb, name, description);
      button.addEventListener('click', () => applyTemplate(template.id));
      els.templateGrid.appendChild(button);
    }
  }

  function buildTemplateThumb(template) {
    const panos = template.build();
    const b = G.combinedBounds(panos.map((p) => p.points));
    const pad = 0.35;
    const node = svgEl('svg', {
      viewBox: `${b.minX - pad} ${b.minY - pad} ${b.width + pad * 2} ${b.height + pad * 2}`,
      preserveAspectRatio: 'xMidYMid meet',
      'aria-hidden': 'true',
    });
    for (const pano of panos) {
      node.appendChild(
        svgEl('path', {
          d: pathData(pano.points),
          fill: pano.color,
          'fill-opacity': '0.28',
          stroke: pano.color,
          'stroke-opacity': '0.7',
          'stroke-width': '1.1',
          'stroke-linejoin': 'round',
          'vector-effect': 'non-scaling-stroke',
        })
      );
    }
    const preview = CALC.analyze(
      { pitch: 30, eaveHeight: 2.5, panos },
      DEFAULT_SHEET
    );
    for (const union of preview.unions) {
      if (union.kind === 'overlap' || union.kind === 'mixed') continue;
      node.appendChild(
        svgEl('line', {
          x1: union.a.x,
          y1: union.a.y,
          x2: union.b.x,
          y2: union.b.y,
          stroke: union.kind === 'valley' ? '#356b88' : '#a8492c',
          'stroke-width': union.kind === 'valley' ? '1.26' : '1.45',
          'stroke-linecap': 'round',
          'stroke-dasharray': union.kind === 'valley' ? '2.6 1.8' : null,
          'vector-effect': 'non-scaling-stroke',
        })
      );
    }
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* Inicio                                                             */
  /* ------------------------------------------------------------------ */

  function setupObservers() {
    if (typeof ResizeObserver !== 'undefined') {
      const planObserver = new ResizeObserver(() => {
        const w = els.planWrap.clientWidth;
        const h = els.planWrap.clientHeight;
        if (!w || !h) return;
        if (w === planSize.w && h === planSize.h) {
          renderPlan();
          return;
        }
        fitPlan();
        renderPlan();
      });
      planObserver.observe(els.planWrap);
      const viewObserver = new ResizeObserver(() => draw3D());
      viewObserver.observe(els.view3dWrap);
    }
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        fitPlan();
        renderPlan();
        draw3D();
      }, 180);
    });
    window.addEventListener('beforeunload', () => {
      if (pendingPayload && pendingPayload !== lastSavedPayload) {
        try {
          localStorage.setItem(STORAGE_KEY, pendingPayload);
        } catch (error) {
          /* ignore */
        }
      }
    });
  }

  function init() {
    cacheDom();
    buildTemplateGrid();
    bindInputs();
    bindToolbar();
    bindPlan();
    bindDial();
    bind3D();
    bindKeyboard();

    const restored = loadState();
    if (!restored) {
      state.roof.panos = TPL.byId('cuatroAguas')
        .build()
        .map((pano) => makePano(pano, DEFAULT_ROOF.pitch));
      state.ui.selectedId = state.roof.panos[0] ? state.roof.panos[0].id : null;
    } else if (!state.ui.selectedId && state.roof.panos.length) {
      state.ui.selectedId = state.roof.panos[0].id;
    }
    ensurePrincipal();

    els.view3d.setAttribute('role', 'img');
    els.view3d.setAttribute('aria-label', 'Vista 3D de la techumbre dibujada');
    analysis = CALC.analyze(state.roof, state.sheet);
    fitPlan();
    render();
    updateToolUI();
    updateDrawHint();
    updateEmpty();
    requestAnimationFrame(() => {
      fitPlan();
      renderPlan();
      draw3D();
    });
    setupObservers();
    setTimeout(() => {
      const w = els.planWrap.clientWidth;
      const h = els.planWrap.clientHeight;
      if (w && h) {
        planSize = { w, h };
        fitPlan();
        renderPlan();
      }
      draw3D();
    }, 70);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
