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
