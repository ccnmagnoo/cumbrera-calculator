/*
 * Cumbrera - plantillas de techumbre
 * Todas las medidas están en metros. El origen está arriba a la izquierda.
 */
(function () {
  'use strict';

  const root = (globalThis.Cumbrera = globalThis.Cumbrera || {});

  const COLORS = [
    '#c2634a',
    '#6f8b73',
    '#5f7d8c',
    '#c99a5b',
    '#8c6f86',
    '#7c8b5a',
    '#a8715a',
    '#5c7e75',
  ];

  function pt(x, y) {
    return { x, y };
  }

  function pano(name, direction, color, points) {
    return { name, direction, color, points };
  }

  const templates = [
    {
      id: 'unAgua',
      name: 'Un agua',
      description: 'Una pendiente',
      build() {
        return [
          pano('Agua principal', 180, COLORS[0], [
            pt(0, 0),
            pt(10, 0),
            pt(10, 6),
            pt(0, 6),
          ]),
        ];
      },
    },
    {
      id: 'dosAguas',
      name: 'Dos aguas',
      description: 'Cumbrera central',
      build() {
        return [
          pano('Norte', 0, COLORS[1], [
            pt(0, 0),
            pt(10, 0),
            pt(10, 3),
            pt(0, 3),
          ]),
          pano('Sur', 180, COLORS[0], [
            pt(0, 3),
            pt(10, 3),
            pt(10, 6),
            pt(0, 6),
          ]),
        ];
      },
    },
    {
      id: 'cuatroAguas',
      name: 'Cuatro aguas',
      description: 'Con limatesas',
      build() {
        return [
          pano('Norte', 0, COLORS[1], [
            pt(0, 0),
            pt(10, 0),
            pt(6, 4),
            pt(4, 4),
          ]),
          pano('Oriente', 90, COLORS[2], [
            pt(10, 0),
            pt(10, 8),
            pt(6, 4),
          ]),
          pano('Sur', 180, COLORS[0], [
            pt(0, 8),
            pt(10, 8),
            pt(6, 4),
            pt(4, 4),
          ]),
          pano('Poniente', 270, COLORS[3], [
            pt(0, 0),
            pt(4, 4),
            pt(0, 8),
          ]),
        ];
      },
    },
    {
      id: 'lConLimahoya',
      name: 'L con limahoya',
      description: 'Dos cuerpos',
      build() {
        return [
          pano('Principal norte', 0, COLORS[1], [
            pt(0, 0),
            pt(12, 0),
            pt(12, 4),
            pt(0, 4),
          ]),
          pano('Principal sur', 180, COLORS[0], [
            pt(0, 4),
            pt(12, 4),
            pt(12, 8),
            pt(6, 8),
            pt(3, 5),
            pt(0, 8),
          ]),
          pano('Ala poniente', 270, COLORS[3], [
            pt(0, 8),
            pt(3, 5),
            pt(3, 14),
            pt(0, 14),
          ]),
          pano('Ala oriente', 90, COLORS[2], [
            pt(6, 8),
            pt(3, 5),
            pt(3, 14),
            pt(6, 14),
          ]),
        ];
      },
    },
  ];

  root.templates = {
    COLORS,
    list: templates,
    byId(id) {
      return templates.find((t) => t.id === id) || null;
    },
  };
})();
