/*
 * Cumbrera - geometría de techumbres
 * Sistema de coordenadas de planta: x hacia la derecha, y hacia abajo (metros).
 * La altura z se calcula a partir de la dirección de escurrimiento y la pendiente.
 */
(function () {
  'use strict';

  const root = (globalThis.Cumbrera = globalThis.Cumbrera || {});
  const EPS = 1e-9;

  function signedArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
  }

  function area(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    return Math.abs(signedArea(points));
  }

  function centroid(points) {
    if (!Array.isArray(points) || points.length === 0) return { x: 0, y: 0 };
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      const cross = p.x * q.y - q.x * p.y;
      a += cross;
      cx += (p.x + q.x) * cross;
      cy += (p.y + q.y) * cross;
    }
    a /= 2;
    if (Math.abs(a) < 1e-8) {
      const avg = points.reduce(
        (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
        { x: 0, y: 0 }
      );
      return avg;
    }
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }

  function bounds(points) {
    if (!points || points.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function combinedBounds(polygons) {
    const all = [];
    for (const pts of polygons) for (const p of pts) all.push(p);
    return bounds(all);
  }

  function direction(deg) {
    const r = (Number(deg) || 0) * (Math.PI / 180);
    return { x: Math.sin(r), y: -Math.cos(r) };
  }

  function angleOfVector(v) {
    return ((Math.atan2(v.x, -v.y) * 180) / Math.PI + 360) % 360;
  }

  function normalize(v) {
    const len = Math.hypot(v.x, v.y);
    if (len < EPS) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function subtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function pointInPolygon(p, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      const intersects =
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function closestPointOnSegment(p, a, b) {
    const ab = subtract(b, a);
    const len2 = ab.x * ab.x + ab.y * ab.y;
    if (len2 < EPS) return { x: a.x, y: a.y, t: 0 };
    let t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + ab.x * t, y: a.y + ab.y * t, t };
  }

  function clipHalfPlane(points, nx, ny, c) {
    const n = points.length;
    if (n === 0) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const fa = a.x * nx + a.y * ny - c;
      const fb = b.x * nx + b.y * ny - c;
      const inA = fa >= -1e-9;
      const inB = fb >= -1e-9;
      if (inA) out.push({ x: a.x, y: a.y });
      if (inA !== inB) {
        const t = fa / (fa - fb);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return dedupe(out);
  }

  function dedupe(points) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-7) out.push(p);
    }
    if (out.length > 1) {
      const first = out[0];
      const last = out[out.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-7) out.pop();
    }
    return out;
  }

  // Interseca el polígono con la franja min <= dot(p, axis) <= max.
  function clipStrip(points, axis, min, max) {
    let result = points;
    result = clipHalfPlane(result, axis.x, axis.y, min);
    if (result.length === 0) return [];
    result = clipHalfPlane(result, -axis.x, -axis.y, -max);
    return result;
  }

  function projectRange(points, axis) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      const value = p.x * axis.x + p.y * axis.y;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return { min, max, size: max - min };
  }

  function cross(a, b) {
    return a.x * b.y - a.y * b.x;
  }

  function segmentsIntersect(a, b, c, d) {
    const ab = subtract(b, a);
    const cd = subtract(d, c);
    const d1 = cross(ab, subtract(c, a));
    const d2 = cross(ab, subtract(d, a));
    const d3 = cross(cd, subtract(a, c));
    const d4 = cross(cd, subtract(b, c));
    if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
        ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
      return true;
    }
    const onSegment = (p, q, r) =>
      Math.abs(cross(subtract(q, p), subtract(r, p))) < 1e-7 &&
      r.x >= Math.min(p.x, q.x) - 1e-7 &&
      r.x <= Math.max(p.x, q.x) + 1e-7 &&
      r.y >= Math.min(p.y, q.y) - 1e-7 &&
      r.y <= Math.max(p.y, q.y) + 1e-7;
    return (
      (Math.abs(d1) < 1e-7 && onSegment(a, b, c)) ||
      (Math.abs(d2) < 1e-7 && onSegment(a, b, d)) ||
      (Math.abs(d3) < 1e-7 && onSegment(c, d, a)) ||
      (Math.abs(d4) < 1e-7 && onSegment(c, d, b))
    );
  }

  function isSimplePolygon(points) {
    const pts = dedupe(points);
    if (pts.length < 3 || area(pts) < 1e-6) return false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
        const c = pts[j];
        const d = pts[(j + 1) % n];
        if (segmentsIntersect(a, b, c, d)) return false;
      }
    }
    return true;
  }

  // Porción común entre dos segmentos (solo si son colineales).
  function segmentOverlap(a1, b1, a2, b2, tol) {
    const tolerance = tol == null ? 0.012 : tol;
    const d1 = subtract(b1, a1);
    const len1 = Math.hypot(d1.x, d1.y);
    if (len1 < 1e-7) return null;
    const ux = d1.x / len1;
    const uy = d1.y / len1;
    const distanceToLine = (p) => Math.abs((p.x - a1.x) * -uy + (p.y - a1.y) * ux);
    if (distanceToLine(a2) > tolerance || distanceToLine(b2) > tolerance) return null;
    const tA = (a2.x - a1.x) * ux + (a2.y - a1.y) * uy;
    const tB = (b2.x - a1.x) * ux + (b2.y - a1.y) * uy;
    const lo = Math.max(0, Math.min(tA, tB));
    const hi = Math.min(len1, Math.max(tA, tB));
    if (hi - lo < tolerance) return null;
    return {
      a: { x: a1.x + ux * lo, y: a1.y + uy * lo },
      b: { x: a1.x + ux * hi, y: a1.y + uy * hi },
      length: hi - lo,
    };
  }

  /**
   * Propiedades de un paño (agua) a partir de su contorno en planta.
   * La dirección indica hacia donde escurre el agua; el alero es el borde
   * de mayor proyección sobre esa dirección.
   */
  function slopeMetrics(points, directionDeg, pitchPct, eaveHeight) {
    const d = direction(directionDeg);
    const t = { x: -d.y, y: d.x };
    const sRange = projectRange(points, d);
    const tRange = projectRange(points, t);
    const tan = Math.max(0, Number(pitchPct) || 0) / 100;
    const cos = 1 / Math.sqrt(1 + tan * tan);
    const pitchAngle = (Math.atan(tan) * 180) / Math.PI;
    const areaPlan = area(points);
    const eave = Number(eaveHeight) || 0;
    let eaveLength = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const sa = a.x * d.x + a.y * d.y;
      const sb = b.x * d.x + b.y * d.y;
      if (Math.abs(sa - sRange.max) < 1e-6 && Math.abs(sb - sRange.max) < 1e-6) {
        eaveLength += distance(a, b);
      }
    }
    return {
      d,
      t,
      sMin: sRange.min,
      sMax: sRange.max,
      tMin: tRange.min,
      tMax: tRange.max,
      run: sRange.size,
      tan,
      slopeFactor: 1 / cos,
      pitchAngle,
      pitch: Number(pitchPct) || 0,
      eaveHeight: eave,
      areaPlan,
      areaRoof: areaPlan / cos,
      maxHeight: eave + sRange.size * tan,
      eaveLength,
      center: centroid(points),
    };
  }

  function pointHeight(point, metrics) {
    const s = point.x * metrics.d.x + point.y * metrics.d.y;
    return metrics.eaveHeight + (metrics.sMax - s) * metrics.tan;
  }

  function inferDirection(points) {
    if (!points || points.length < 3) return 180;
    let best = null;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const len = distance(a, b);
      if (!best || len > best.len) best = { a, b, len };
    }
    const e = normalize(subtract(best.b, best.a));
    const n = { x: -e.y, y: e.x };
    const mid = midpoint(best.a, best.b);
    const c = centroid(points);
    const outward = dot(n, subtract(c, mid)) > 0 ? { x: -n.x, y: -n.y } : n;
    return Math.round(angleOfVector(outward)) % 360;
  }

  const CARDINALS = [
    { deg: 0, name: 'Norte', short: 'N' },
    { deg: 45, name: 'Noreste', short: 'NE' },
    { deg: 90, name: 'Este', short: 'E' },
    { deg: 135, name: 'Sureste', short: 'SE' },
    { deg: 180, name: 'Sur', short: 'S' },
    { deg: 225, name: 'Suroeste', short: 'SO' },
    { deg: 270, name: 'Oeste', short: 'O' },
    { deg: 315, name: 'Noroeste', short: 'NO' },
  ];

  function directionLabel(deg) {
    const normalized = ((Number(deg) % 360) + 360) % 360;
    const rounded = Math.round(normalized);
    let nearest = CARDINALS[0];
    let min = Infinity;
    for (const c of CARDINALS) {
      let diff = Math.abs(normalized - c.deg);
      if (diff > 180) diff = 360 - diff;
      if (diff < min) {
        min = diff;
        nearest = c;
      }
    }
    if (min <= 0.5) return `${nearest.name} · ${rounded}°`;
    return `${nearest.name} · ${rounded}°`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, decimals) {
    const factor = Math.pow(10, decimals || 0);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  root.geometry = {
    signedArea,
    area,
    centroid,
    bounds,
    combinedBounds,
    direction,
    angleOfVector,
    normalize,
    dot,
    subtract,
    distance,
    midpoint,
    pointInPolygon,
    closestPointOnSegment,
    clipHalfPlane,
    clipStrip,
    projectRange,
    segmentsIntersect,
    isSimplePolygon,
    segmentOverlap,
    slopeMetrics,
    pointHeight,
    inferDirection,
    directionLabel,
    clamp,
    round,
    CARDINALS,
  };
})();
