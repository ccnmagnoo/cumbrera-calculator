/*
 * Cumbrera - cálculo de planchas y uniones de aguas
 *
 * Cada agua se cubre con franjas paralelas a la dirección de escurrimiento.
 * El ancho de cada franja es el ancho útil de la plancha y su largo se obtiene
 * del recorrido real entre el alero y la cumbrera, limatesa o limahoya que la
 * limita. Se incluye un margen de corte y se dividen los tramos que superan el
 * largo máximo comercial.
 */
(function () {
  'use strict';

  const root = (globalThis.Cumbrera = globalThis.Cumbrera || {});
  const G = root.geometry;

  function splitLengths(required, sheet) {
    const maxLength = Math.max(0.3, Number(sheet.maxLength) || 6);
    const step = Math.max(0.01, Number(sheet.lengthStep) || 0.1);
    const overlap = G.clamp(
      Number(sheet.longitudinalOverlap) || 0,
      0,
      Math.max(0, maxLength - 0.15)
    );
    let count = 1;
    if (required > maxLength + 1e-9) {
      count = Math.ceil((required - overlap) / (maxLength - overlap));
      if (!Number.isFinite(count) || count < 1) count = 1;
    }
    const lengths = [];
    for (let i = 0; i < count; i++) {
      let length =
        i < count - 1
          ? maxLength
          : required - (count - 1) * (maxLength - overlap);
      length = Math.ceil((length - 1e-9) / step) * step;
      length = Math.min(maxLength, length);
      length = Math.max(step, G.round(length, 3));
      lengths.push(length);
    }
    return lengths;
  }

  function calculateLayout(points, metrics, sheet) {
    const anchoUtil = Math.max(
      0.05,
      (Number(sheet.width) || 0.8) - (Number(sheet.lateralOverlap) || 0)
    );
    const width = Math.max(0.05, Number(sheet.width) || 0.8);
    const endAllowance = Math.max(0, Number(sheet.endAllowance) || 0);
    const columns = Math.max(
      1,
      Math.ceil((metrics.tMax - metrics.tMin) / anchoUtil - 1e-9)
    );
    const pieces = [];
    const lengthCounts = new Map();
    let linear = 0;
    let maxPiece = 0;
    let maxColumnLength = 0;
    let usedColumns = 0;

    for (let i = 0; i < columns; i++) {
      const t0 = metrics.tMin + i * anchoUtil;
      const t1 = t0 + anchoUtil;
      const strip = G.clipStrip(points, metrics.t, t0, t1);
      if (strip.length < 3) continue;
      const sRange = G.projectRange(strip, metrics.d);
      const run = sRange.max - sRange.min;
      if (!Number.isFinite(run) || run < 0.05) continue;

      const required = run * metrics.slopeFactor + endAllowance;
      maxColumnLength = Math.max(maxColumnLength, required);
      const lengths = splitLengths(required, sheet);
      usedColumns += 1;
      for (const length of lengths) {
        pieces.push(length);
        linear += length;
        maxPiece = Math.max(maxPiece, length);
        const key = length.toFixed(2);
        const entry = lengthCounts.get(key) || { length, count: 0 };
        entry.count += 1;
        lengthCounts.set(key, entry);
      }
    }

    const purchasedArea = linear * width;
    const usefulArea = metrics.areaRoof;
    return {
      columns,
      usedColumns,
      pieces,
      sheetCount: pieces.length,
      linear,
      purchasedArea,
      usefulArea,
      wastePct: purchasedArea > 0 ? Math.max(0, 1 - usefulArea / purchasedArea) : 0,
      maxPiece,
      maxColumnLength,
      lengthCounts,
      anchoUtil,
    };
  }

  function sideOfEdge(points, midpoint, normal, edgeLength) {
    const probe = Math.min(0.04, Math.max(0.01, edgeLength * 0.15));
    const plus = { x: midpoint.x + normal.x * probe, y: midpoint.y + normal.y * probe };
    const minus = { x: midpoint.x - normal.x * probe, y: midpoint.y - normal.y * probe };
    if (G.pointInPolygon(plus, points)) return 1;
    if (G.pointInPolygon(minus, points)) return -1;
    return 0;
  }

  function detectUnions(panos) {
    const unions = [];
    for (let i = 0; i < panos.length; i++) {
      const A = panos[i];
      for (let j = i + 1; j < panos.length; j++) {
        const B = panos[j];
        const pa = A.pano.points;
        const pb = B.pano.points;
        for (let ei = 0; ei < pa.length; ei++) {
          const a1 = pa[ei];
          const b1 = pa[(ei + 1) % pa.length];
          for (let ej = 0; ej < pb.length; ej++) {
            const a2 = pb[ej];
            const b2 = pb[(ej + 1) % pb.length];
            const segment = G.segmentOverlap(a1, b1, a2, b2, 0.012);
            if (!segment || segment.length < 0.05) continue;

            const edge = G.normalize(G.subtract(b1, a1));
            const normal = { x: -edge.y, y: edge.x };
            const mid = G.midpoint(segment.a, segment.b);
            const sideA = sideOfEdge(pa, mid, normal, segment.length);
            const sideB = sideOfEdge(pb, mid, normal, segment.length);
            if (sideA === 0 || sideB === 0) continue;

            const flowA = sideA * G.dot(A.metrics.d, normal);
            const flowB = sideB * G.dot(B.metrics.d, normal);
            let type;
            if (sideA === sideB) type = 'overlap';
            else if (flowA > 0.02 && flowB > 0.02) type = 'high';
            else if (flowA < -0.02 && flowB < -0.02) type = 'low';
            else type = 'mixed';

            const zA1 = G.pointHeight(segment.a, A.metrics);
            const zA2 = G.pointHeight(segment.b, A.metrics);
            const zB1 = G.pointHeight(segment.a, B.metrics);
            const zB2 = G.pointHeight(segment.b, B.metrics);
            const mismatch = Math.max(Math.abs(zA1 - zB1), Math.abs(zA2 - zB2));

            let kind = type;
            if (type === 'high') {
              kind = Math.abs(zA1 - zA2) < 0.02 ? 'ridge' : 'hip';
            } else if (type === 'low') {
              kind = 'valley';
            }

            unions.push({
              kind,
              type,
              panoA: A.pano,
              panoB: B.pano,
              a: segment.a,
              b: segment.b,
              length: segment.length,
              mismatch,
              zA1,
              zA2,
              zB1,
              zB2,
            });
          }
        }
      }
    }
    return unions;
  }

  function analyze(roof, sheetConfig) {
    const pitch = Math.max(0, Number(roof.pitch) || 0);
    const eaveHeight = Math.max(0, Number(roof.eaveHeight) || 0);
    const panos = (roof.panos || []).map((pano) => {
      const metrics = G.slopeMetrics(pano.points, pano.direction, pitch, eaveHeight);
      const layout = calculateLayout(pano.points, metrics, sheetConfig);
      return { pano, metrics, layout };
    });

    const unions = detectUnions(panos);
    const totals = {
      sheets: 0,
      linear: 0,
      purchasedArea: 0,
      roofArea: 0,
      planArea: 0,
      eaveLength: 0,
      wastePct: 0,
      lengthCounts: new Map(),
      byKind: { ridge: 0, hip: 0, valley: 0 },
    };
    for (const item of panos) {
      totals.sheets += item.layout.sheetCount;
      totals.linear += item.layout.linear;
      totals.purchasedArea += item.layout.purchasedArea;
      totals.roofArea += item.metrics.areaRoof;
      totals.planArea += item.metrics.areaPlan;
      totals.eaveLength += item.metrics.eaveLength;
      for (const entry of item.layout.lengthCounts.values()) {
        const current =
          totals.lengthCounts.get(entry.length.toFixed(2)) || {
            length: entry.length,
            count: 0,
          };
        current.count += entry.count;
        totals.lengthCounts.set(entry.length.toFixed(2), current);
      }
    }
    totals.wastePct =
      totals.purchasedArea > 0
        ? Math.max(0, 1 - totals.roofArea / totals.purchasedArea)
        : 0;

    for (const union of unions) {
      if (totals.byKind[union.kind] != null) {
        totals.byKind[union.kind] += union.length;
      }
    }

    const warnings = [];
    const seen = new Set();
    const addWarning = (level, text) => {
      if (seen.has(text)) return;
      seen.add(text);
      warnings.push({ level, text });
    };

    for (const item of panos) {
      const { pano, metrics, layout } = item;
      if (!G.isSimplePolygon(pano.points)) {
        addWarning('warn', `El contorno de «${pano.name}» se cruza. Revisa sus vértices.`);
      }
      if (metrics.areaPlan < 0.25) {
        addWarning('warn', `«${pano.name}» es muy pequeño; revisa su forma.`);
      }
      if (metrics.areaPlan > 0.25 && metrics.eaveLength < 0.15) {
        addWarning(
          'warn',
          `«${pano.name}» no tiene un alero claro con la dirección elegida. Ajusta el escurrimiento.`
        );
      }
      if (layout.sheetCount === 0) {
        addWarning('warn', `No se pudieron calcular planchas para «${pano.name}».`);
      }
    }

    for (const union of unions) {
      const names = `«${union.panoA.name}» y «${union.panoB.name}»`;
      if (union.type === 'overlap') {
        addWarning('warn', `Los paños ${names} se superponen en planta.`);
      } else if (union.type === 'mixed') {
        addWarning(
          'warn',
          `La unión entre ${names} no es una cumbrera ni una limahoya. Revisa la dirección del agua.`
        );
      }
      if (union.type !== 'overlap' && union.mismatch > 0.03) {
        addWarning(
          'warn',
          `Las alturas no coinciden en la unión de ${names} (${(union.mismatch * 100).toFixed(0)} cm).`
        );
      }
    }

    const maxRun = panos.reduce((max, p) => Math.max(max, p.metrics.run), 0);
    const maxHeight = panos.reduce((max, p) => Math.max(max, p.metrics.maxHeight), 0);
    const bbox = G.combinedBounds(panos.map((p) => p.pano.points));

    return {
      panos,
      unions,
      totals,
      warnings,
      maxRun,
      maxHeight,
      bbox,
      pitch,
      eaveHeight,
    };
  }

  root.calc = {
    analyze,
    calculateLayout,
    splitLengths,
    detectUnions,
  };
})();
