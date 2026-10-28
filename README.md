# Cumbrera

Calculadora de planchas para techumbres de varias aguas, con una interfaz para dibujar la cubierta en planta y revisarla en 3D.

La app calcula la cantidad de planchas, los largos a pedir, la superficie comprada, el desperdicio estimado y los metros lineales de cumbreras, limatesas y limahoyas.

## Cómo abrirla

No requiere instalación ni compilación. Abre `index.html` con Chrome, Edge o Firefox.

Si tu navegador restringe `localStorage` al abrir archivos locales, sirve la carpeta con un servidor estático:

```bash
python -m http.server 8080
```

y visita `http://localhost:8080`.

## Cómo usarla

1. **Elige una plantilla** o presiona **Dibujar agua** y haz clic en los vértices del paño. Cierra en el primer punto o con Enter.
2. **Ajusta la cubierta**: pendiente y cumbrera del agua principal, y altura de alero. El agua principal es la referencia; puedes marcar otra con la estrella. La cumbrera principal editable ajusta la pendiente de esa agua.
3. **Ajusta cada agua**: selecciónala en el plano o en la tabla. Arrastra sus vértices, cambia la dirección de escurrimiento con el dial y personaliza su pendiente. Los vértices compartidos se mueven en todas las aguas conectadas. Si cambias la pendiente principal, usa **Igualar alturas de las secundarias** para recalcular las aguas conectadas.
4. **Configura la plancha**: tipo (zinc liso u ondulada), ancho total, traslape lateral, largo máximo, redondeo, traslape longitudinal y margen de corte.
5. **Revisa los resultados** en el encabezado, en la tarjeta de resultados y en la tabla. La vista 3D permite comprobar la forma y las alturas. El botón **Exportar CSV** genera una lista lista para cotizar.

Atajos: `V` seleccionar, `P` dibujar, `Enter` cerrar el agua en dibujo, `Esc` cancelar/deseleccionar, `Ctrl+Z` deshacer, `Ctrl+Shift+Z` rehacer, `Supr` eliminar el agua seleccionada. La rueda hace zoom en el plano; arrastra el fondo para moverlo.

### Plantillas incluidas

- **Un agua**: una pendiente.
- **Dos aguas**: cumbrera central.
- **Tres aguas**: limatesa en un extremo y gablete en el otro.
- **Cuatro aguas**: cumbrera corta y cuatro limatesas.
- **Pabellón**: cuatro aguas que llegan a una punta, sin cumbrera.
- **L con limahoya**: dos cuerpos en ángulo recto con una limahoya.
- **T con limahoya**: cuerpo principal con un ala central y dos limahoyas.

Puedes editar cualquier plantilla arrastrando sus vértices. Las plantillas son puntos de partida; las medidas se ajustan en el plano y en el panel de cada agua.

## Pendientes y agua principal

Cada agua tiene su propia pendiente. Por defecto, la app elige como **agua principal** la de mayor superficie y le asigna la pendiente base; puedes cambiarla con la estrella que aparece en la ficha del agua. La principal es la referencia para la cumbrera y para el auto-ajuste.

- La **pendiente principal** se edita en Cubierta o en la ficha del agua principal.
- La **cumbrera principal** es la altura máxima de esa agua. La **cumbrera máxima** que muestra la vista 3D es el punto más alto de toda la techumbre, que podría ser otra agua si la personalizas.
- El botón **Igualar alturas de las secundarias** recorre las aguas conectadas desde la principal, unión por unión, y calcula la pendiente de cada secundaria para igualar las alturas en los extremos de la unión. No cambia el agua principal.
- Si un agua no está conectada a la principal, no se ajusta y se informa. Si una unión no se puede igualar con una pendiente constante, la app deja el mejor ajuste y muestra la diferencia en **Revisión**.
- Las planchas y sus largos se calculan con la pendiente de cada agua.

## Cómo se calcula

Cada agua se divide en franjas paralelas a su dirección de escurrimiento. El ancho de cada franja es el **ancho útil** de la plancha (ancho total menos traslape lateral). El largo de la franja usa la pendiente propia de esa agua.

- El largo de cada franja se mide desde el alero hasta la cumbrera, limatesa o limahoya que la limita, sobre la pendiente real.
- Se suma un margen de corte y se redondea hacia arriba al múltiplo configurado.
- Si el largo supera el máximo comercial, se divide en tramos con traslape longitudinal.
- Se cuenta una plancha por franja. El cálculo es **conservador**: no reutiliza recortes entre franjas. Por eso el desperdicio mostrado puede ser mayor que el de una instalación que aproveche recortes.
- Las uniones se detectan cuando dos aguas comparten un borde. Según cómo escurra el agua en cada lado, se clasifican como cumbrera, limatesa o limahoya; también se avisa si las alturas no coinciden o si una unión no tiene una dirección clara.

El área de cubierta es la superficie real (incluye la pendiente). El área comprada es el largo total de planchas por el ancho total. El desperdicio es la diferencia entre ambas.

No se incluyen estructura, costaneras, fijaciones, aislación, canaletas, tapacanes ni cumbreras como material: solo se informan los metros lineales de las uniones.

## Estructura

```text
index.html          Interfaz
styles.css          Estilos
js/geometry.js      Geometría de polígonos y pendientes
js/templates.js     Plantillas de techumbre
js/calc.js          Cálculo de franjas, planchas y uniones
js/app.js           Editor de planta, vista 3D, estado y persistencia
tests/calc.test.js  Pruebas de geometría y cálculo
```

## Pruebas

```bash
npm test
```

o directamente:

```bash
node --test
```

Las pruebas verifican áreas, plantillas, alturas, limahoyas, pendientes por agua, auto-ajuste, conteos de planchas y división de largos.

## Supuestos y límites

- Las medidas están en metros y el origen de la planta está arriba a la izquierda.
- La altura de alero es común. Cada agua tiene su propia pendiente, y la altura de cada cumbrera se deriva de su pendiente y su desarrollo. El agua principal es la referencia; las aguas sin conexión no se auto-ajustan.
- Cada agua es un plano. La app no genera automáticamente una techumbre desde el contorno de la casa: el usuario define los paños (o parte de una plantilla).
- No modela lucarnas, perforaciones, cambios de pendiente dentro de un paño, aleros escalonados ni encuentros con muros.
- El resultado es una estimación de materiales; confirma medidas, traslapes y disponibilidad de largos con tu proveedor antes de comprar.
