'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../js/geometry.js');
require('../js/templates.js');
require('../js/calc.js');

const G = globalThis.Cumbrera.geometry;
const T = globalThis.Cumbrera.templates;
const C = globalThis.Cumbrera.calc;

const SHEET = {
  width: 0.8,
  lateralOverlap: 0.04,
  maxLength: 6,
  lengthStep: 0.1,
  endAllowance: 0.05,
  longitudinalOverlap: 0.15,
};

function roofFrom(templateId, overrides = {}) {
  const template = T.byId(templateId);
  return {
    pitch: 30,
    eaveHeight: 2.5,
    panos: template.build().map((p, i) => ({ id: `p${i}`, ...p })),
    ...overrides,
  };
}

function analyze(templateId, overrides = {}) {
  return C.analyze(roofFrom(templateId, overrides), SHEET);
}

test('área y centroide de un rectángulo', () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 6 },
    { x: 0, y: 6 },
  ];
  assert.equal(G.area(rect), 60);
  const c = G.centroid(rect);
  assert.ok(Math.abs(c.x - 5) < 1e-9);
  assert.ok(Math.abs(c.y - 3) < 1e-9);
});

test('plantillas: superficies y alturas coherentes', () => {
  const one = analyze('unAgua');
  assert.equal(one.totals.planArea, 60);
  assert.ok(Math.abs(one.maxHeight - (2.5 + 6 * 0.3)) < 1e-9);
  assert.equal(one.totals.byKind.ridge, 0);
  assert.equal(one.totals.byKind.valley, 0);

  const two = analyze('dosAguas');
  assert.equal(two.totals.planArea, 60);
  assert.ok(Math.abs(two.totals.byKind.ridge - 10) < 1e-9);
  assert.equal(two.totals.byKind.valley, 0);

  const four = analyze('cuatroAguas');
  assert.equal(four.totals.planArea, 80);
  assert.ok(Math.abs(four.totals.byKind.ridge - 2) < 1e-9);
  assert.ok(Math.abs(four.totals.byKind.hip - 4 * Math.hypot(4, 4)) < 1e-9);
  assert.equal(four.totals.byKind.valley, 0);
  assert.equal(four.warnings.length, 0);
});

test('plantillas nuevas: tres aguas, pabellón y T', () => {
  const three = analyze('tresAguas');
  assert.ok(Math.abs(three.totals.planArea - 80) < 1e-9);
  assert.ok(Math.abs(three.totals.byKind.ridge - 6) < 1e-9);
  assert.ok(Math.abs(three.totals.byKind.hip - 2 * Math.hypot(4, 4)) < 1e-9);
  assert.equal(three.totals.byKind.valley, 0);
  assert.equal(three.warnings.length, 0);
  for (const item of three.panos) {
    assert.ok(Math.abs(item.metrics.maxHeight - 3.7) < 1e-9);
  }

  const pavilion = analyze('pabellon');
  assert.ok(Math.abs(pavilion.totals.planArea - 64) < 1e-9);
  assert.equal(pavilion.totals.byKind.ridge, 0);
  assert.ok(Math.abs(pavilion.totals.byKind.hip - 4 * Math.hypot(4, 4)) < 1e-9);
  assert.equal(pavilion.totals.byKind.valley, 0);
  assert.equal(pavilion.warnings.length, 0);
  for (const item of pavilion.panos) {
    assert.ok(Math.abs(item.metrics.maxHeight - 3.7) < 1e-9);
  }

  const tee = analyze('tConLimahoya');
  assert.ok(Math.abs(tee.totals.planArea - 148) < 1e-9);
  assert.ok(Math.abs(tee.totals.byKind.ridge - 23) < 1e-9);
  assert.ok(Math.abs(tee.totals.byKind.valley - 2 * Math.hypot(3, 3)) < 1e-9);
  assert.equal(tee.totals.byKind.hip, 0);
  assert.equal(tee.warnings.length, 0);
  for (const union of tee.unions) {
    assert.ok(union.mismatch < 1e-9, `desfase en unión ${union.kind}`);
  }
  const mainSouth = tee.panos.find((p) => p.pano.name === 'Principal sur');
  assert.ok(G.isSimplePolygon(mainSouth.pano.points));
  assert.ok(Math.abs(mainSouth.metrics.areaPlan - 47) < 1e-9);
  assert.ok(Math.abs(mainSouth.metrics.maxHeight - 3.7) < 1e-9);
});

test('catálogo de plantillas: siete techumbres operativas', () => {
  const ids = T.list.map((template) => template.id);
  assert.deepEqual(ids, [
    'unAgua',
    'dosAguas',
    'tresAguas',
    'cuatroAguas',
    'pabellon',
    'lConLimahoya',
    'tConLimahoya',
  ]);
  for (const id of ids) {
    assert.ok(analyze(id).totals.sheets > 0, `${id} no genera planchas`);
  }
});

test('techumbre en L: limahoyas, cumbreras y alturas coincidentes', () => {
  const l = analyze('lConLimahoya');
  assert.equal(l.totals.planArea, 132);
  assert.ok(Math.abs(l.totals.byKind.ridge - 21) < 1e-9);
  assert.ok(Math.abs(l.totals.byKind.valley - 2 * Math.hypot(3, 3)) < 1e-9);
  assert.equal(l.totals.byKind.hip, 0);
  for (const union of l.unions) {
    assert.ok(union.mismatch < 1e-9, `desfase en unión ${union.kind}`);
  }
  assert.equal(l.warnings.length, 0);
  const mainSouth = l.panos.find((p) => p.pano.name === 'Principal sur');
  assert.ok(G.isSimplePolygon(mainSouth.pano.points));
  assert.ok(mainSouth.metrics.areaPlan > 0);
});

test('cada agua puede tener su propia pendiente', () => {
  const roof = roofFrom('dosAguas');
  roof.panos[0].pitch = 40;
  roof.panos[1].pitch = 20;
  const result = C.analyze(roof, SHEET);
  assert.equal(result.panos[0].metrics.pitch, 40);
  assert.equal(result.panos[1].metrics.pitch, 20);
  assert.ok(Math.abs(result.panos[0].metrics.maxHeight - 3.7) < 1e-9);
  assert.ok(Math.abs(result.panos[1].metrics.maxHeight - 3.1) < 1e-9);
  assert.ok(result.unions[0].mismatch > 0.5);
  assert.ok(result.warnings.some((warning) => warning.text.includes('alturas')));
});

test('auto-ajuste: iguala la cumbrera secundaria con la principal', () => {
  const roof = {
    pitch: 30,
    eaveHeight: 2.5,
    panos: [
      {
        id: 'n',
        name: 'Norte',
        color: '#6f8b73',
        direction: 0,
        pitch: 40,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 3 },
          { x: 0, y: 3 },
        ],
      },
      {
        id: 's',
        name: 'Sur',
        color: '#c2634a',
        direction: 180,
        pitch: 30,
        points: [
          { x: 0, y: 3 },
          { x: 10, y: 3 },
          { x: 10, y: 8 },
          { x: 0, y: 8 },
        ],
      },
    ],
  };
  const result = C.autoAlignPitches(roof, 'n');
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].panoId, 's');
  assert.ok(Math.abs(result.changes[0].pitch - 24) < 0.11);
  assert.ok(result.changes[0].mismatch < 0.02);
  assert.equal(result.skipped.length, 0);
  assert.equal(roof.panos[1].pitch, 30, 'la función no debe mutar el roof');

  roof.panos[1].pitch = result.changes[0].pitch;
  const applied = C.analyze(roof, SHEET);
  assert.equal(applied.warnings.length, 0);
  assert.ok(
    Math.abs(
      applied.panos[0].metrics.maxHeight - applied.panos[1].metrics.maxHeight
    ) < 0.02
  );
  assert.ok(applied.unions[0].mismatch < 0.02);
});

test('auto-ajuste: propaga la pendiente principal por las aguas conectadas', () => {
  const roof = roofFrom('lConLimahoya');
  roof.panos.forEach((pano) => {
    pano.pitch = 30;
  });
  roof.panos[0].pitch = 40;
  const result = C.autoAlignPitches(roof, 'p0');
  assert.equal(result.changes.length, 3);
  assert.equal(result.skipped.length, 0);
  for (const change of result.changes) {
    assert.ok(Math.abs(change.pitch - 40) < 0.11);
    roof.panos.find((pano) => pano.id === change.panoId).pitch = change.pitch;
  }
  const applied = C.analyze(roof, SHEET);
  assert.equal(applied.warnings.length, 0);
  for (const union of applied.unions) {
    assert.ok(union.mismatch < 0.02);
  }
});

test('auto-ajuste: informa aguas sin conexión al agua principal', () => {
  const roof = {
    pitch: 30,
    eaveHeight: 2.5,
    panos: [
      {
        id: 'a',
        name: 'A',
        color: '#c2634a',
        direction: 180,
        pitch: 30,
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
      },
      {
        id: 'b',
        name: 'B',
        color: '#5f7d8c',
        direction: 180,
        pitch: 30,
        points: [
          { x: 8, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 4 },
          { x: 8, y: 4 },
        ],
      },
    ],
  };
  const result = C.autoAlignPitches(roof, 'a');
  assert.equal(result.changes.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].panoId, 'b');
});

test('un agua: 10 m de alero y 6 m de desarrollo exige dos tramos', () => {
  const one = analyze('unAgua');
  const pano = one.panos[0];
  assert.equal(pano.layout.columns, 14); // ceil(10 / 0,76)
  assert.equal(pano.layout.sheetCount, 28); // 6,315 m de desarrollo > 6 m máximo
  assert.ok(Math.abs(pano.layout.maxColumnLength - (6 * Math.sqrt(1.09) + 0.05)) < 1e-9);
  assert.equal(pano.layout.maxPiece, 6);
  assert.equal(one.totals.sheets, 28);
});

test('largos mayores al máximo se dividen con traslape longitudinal', () => {
  const pieces = C.splitLengths(7, SHEET);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0], 6);
  assert.ok(Math.abs(pieces[1] - 1.2) < 1e-9);
  const coverage = pieces.reduce((a, b) => a + b, 0) - SHEET.longitudinalOverlap;
  assert.ok(coverage >= 7);

  const single = C.splitLengths(3.14, SHEET);
  assert.deepEqual(single, [3.2]);
});

test('cuatro aguas: todas las aguas usan el mismo plano de cumbrera', () => {
  const four = analyze('cuatroAguas');
  for (const item of four.panos) {
    assert.ok(Math.abs(item.metrics.maxHeight - 3.7) < 1e-9);
  }
  assert.ok(four.totals.sheets > 0);
  assert.ok(four.totals.linear > 0);
  assert.ok(four.totals.wastePct >= 0 && four.totals.wastePct < 0.6);
});

test('detecta superposiciones y direcciones inconsistentes', () => {
  const panos = [
    {
      id: 'a',
      name: 'A',
      color: '#c2634a',
      direction: 180,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    },
    {
      id: 'b',
      name: 'B',
      color: '#5f7d8c',
      direction: 90,
      points: [
        { x: 4, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 4 },
        { x: 4, y: 4 },
      ],
    },
  ];
  const result = C.analyze({ pitch: 30, eaveHeight: 2.5, panos }, SHEET);
  assert.equal(result.unions.length, 1);
  assert.equal(result.unions[0].type, 'mixed');
  assert.ok(result.warnings.length > 0);
});

test('la dirección de escurrimiento se infiere hacia afuera', () => {
  const direction = G.inferDirection([
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: 8, y: 5 },
    { x: 0, y: 5 },
  ]);
  assert.ok(direction === 180 || direction === 0);
});

test('el clip de franjas no genera puntos inválidos', () => {
  const l = analyze('lConLimahoya');
  const pano = l.panos[1];
  const t0 = pano.metrics.tMin + 2;
  const strip = G.clipStrip(pano.pano.points, pano.metrics.t, t0, t0 + 0.76);
  assert.ok(strip.length >= 3);
  for (const p of strip) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});
