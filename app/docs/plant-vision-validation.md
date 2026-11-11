# Validacion de manchas foliares

## Perfil cerrado tablet-leaf-v1: 2026-11-03

Se reemplazo el ensayo sincronizado por una tarea visual controlada: la misma
silueta, sin peciolo estrecho, amarillo en parches espaciales y seis firmas
ampliadas. Las firmas son artificiales (incluido el tinte violeta del plateado),
no insectos reconocidos por especie. El Site publicado original no se cambia.

El analizador `leaf-pixel-v4.7/tablet-leaf-v1` requiere dos extremos magenta
y nueve referencias constantes fotografiadas en la tira inferior. Calibra
colores de cada foto, excluye la tira, limita el analisis a la lamina y exige
repeticion de firmas en la rafaga. No consulta los controles del simulador.
La cromaticidad tolera variacion de brillo en la pantalla; los bordes borrosos
proximos a un nucleo coloreado no se presentan como otra plaga simulada.
Sin referencias, encuadre completo o consistencia de la rafaga no hay medida
valida. El algoritmo general de plantas no es una alternativa automatica.

Resultados con fotos de la tablet fisica, fondo gris, escala 0.85, giro 90,
QXGA y sin flash:

| Caso | Amarillo solicitado | Amarillo fotografiado | Firmas repetidas |
| --- | --- | --- | --- |
| Hoja sana, rafaga `plant-mw1abpq1` | 0 | 0% | Ninguna; manchas 0% |
| Amarillo completo, `plant-mw1adayy` | 100 | 97.8% | Ninguna; manchas 0% |
| Mixto, `plant-mw1afj6a` | 35 | 34.6% | Las seis firmas ampliadas |

La rafaga mixta se uso para ajustar la separacion de colores: estos resultados
no son una evaluacion ciega ni una medida de exactitud en otros escenarios.
Se reevaluo en el navegador con v4.7 y se guardo esa version en HydroVision.
Las dos referencias independientes se reprodujeron con v4.7 desde sus tres
JPEG, decodificados y reducidos a 1024x768 con System.Drawing. Esa comprobacion
no es otra captura ni una validacion en otra iluminacion, tablet o cultivo.
Al final la tablet dejo de confirmar; la ultima reevaluacion uso la rafaga
guardada, conservando su fecha de captura, no una imagen nueva.

Pruebas automaticas: 92 definidas, 79 aprobadas, ninguna fallida y 13 omitidas
por falta del corpus fotografico historico opcional. Se incluyen las seis
firmas aisladas con bordes mezclados, amarillo total, referencia ausente,
objeto rectangular, cambio de posicion, distinta exposicion/brillo y firmas
que aparecen en una sola foto. Esto valida logica, no eficacia biologica.

## Historico: ensayos anteriores con tablet (v4.4)

Se fotografio la tablet fisica confirmada por el servidor (no la ventana de
prueba en la PC), con fondo gris, escala 0.85, giro 90 grados y rafagas de tres
JPEG QXGA sin flash. La clasificacion visual usa los pixeles y la repeticion;
los parametros solicitados al simulador solo se conservan como contexto.
El clasificador comun `app/scripts/plant-report.js` se usa tanto en HydroVision
como en el panel. Las conclusiones no identifican especies de plaga.

Resultados observados, no medidas de exactitud ni calibracion biologica:

| Caso | Ajustes simulados | Conclusion de las fotos | Amarillo medido | Manchas repetidas |
| --- | --- | --- | --- | --- |
| 4 | Referencia sana | Referencia evaluable | 0% | 0% |
| 5 | Amarillo 40, sin plagas | Una zona amarillenta repetida | 1.14% | 0% |
| 6 | Amarillo 60, sin plagas | Sin lectura: segmentacion foliar insuficiente | No evaluable | No evaluable |
| 7 | Minadores 70 | Marcas por revisar | 0% | 0% |
| 8 | Orugas 60 | Marcas por revisar | 0% | 0% |
| 9 | Pulgones 70 | Manchas posibles | 0% | 0.10% |
| 10 | Amarillo 35 y seis plagas a 45 | Manchas y amarillamiento | 0.91% | 0.28% |

Los numeros del simulador ajustan apariencia e intensidad; no representan el
porcentaje fisico de superficie afectada. Por ello no se espera igualdad con
los porcentajes medidos. El caso 6 demuestra una limitacion real del algoritmo
cuando desaparece mucho verde, no una hoja sana. En los casos 7 y 8 hubo
marcas candidatas, pero no repetidas cuantificables: esto no identifica ni
descarta insectos, galerias o perforaciones. No se modificaron los umbrales
para conseguir aciertos en estas pruebas.

La superposicion del caso mixto localiza buena parte de la senal amarillenta
cerca del peciolo; no demuestra una medicion de clorosis de toda la lamina.
El detector actual no garantiza excluir toda pigmentacion natural del tallo.
La region marcada y la foto original deben revisarse, no solo el numero.

La tabla de ensayos recientes conserva esos limites en la interfaz y muestra
los valores no evaluables como tales. Fotos y metadatos quedan en el corpus
privado `data/plant-captures/case-<burst>.json`. Las pruebas fotograficas de
septiembre siguen omitidas en esta PC por faltar su corpus y la dependencia
opcional de lectura; no se presentan como verificadas por estos ensayos.

## Pruebas con una pantalla de tablet

Configurar `CAMERA_CAPTURE_TARGET=screen` en `.env.camera.local` y reiniciar el
servidor. Este modo fuerza el flash de analisis a cero y usa contraste neutro
por defecto. No cambia los umbrales del algoritmo para favorecer la simulacion.
Las fotos conservan QXGA y la rafaga de tres cuadros.

Las capturas llevan `captureTarget: screen` y un protocolo de luz propio.
El dashboard muestra solo el historial del modo activo, con un limite de 40
analisis por modo; las entradas antiguas sin etiqueta se consideran hojas reales.
Las comparaciones temporales nunca mezclan pantalla y planta. Para volver al
cultivo, quitar `CAMERA_CAPTURE_TARGET=screen` y reiniciar; el historial se conserva.

Mantener la hoja completa dentro del encuadre, camara y tablet fijas y brillo
estable. El foco es fisico: aumentar resolucion no corrige desenfoque. La
simulacion comprueba respuestas visuales a colores y marcas, no identifica
plagas ni valida exactitud sobre hojas reales. Una hoja completamente amarilla
o marron puede quedar fuera de la segmentacion que depende de verde reconocible.

Fecha: 2026-09-04. Version del analisis: `leaf-pixel-v4.1`.

## Nitidez y fallos intermitentes: 2026-09-07, v4.4

Se reprodujeron las entradas fallidas de la tarde. La condicion de proximidad descartaba regiones amarillas de unos 27000-32000 pixeles cuando la mascara verde reconstruida se reducia, aunque seguian cerca de verde reconocible antes de la reconstruccion. Ademas, cambios de posicion dejaron parte de la hoja fuera de la seleccion, fragmentandola antes de evaluar su forma. No era solamente un umbral de color.

Cambios: contexto verde tras apertura, soporte de proximidad limitado por el lado corto de cada region y evaluacion de forma amarilla en la imagen completa antes del recorte. Solo se marcan pixeles dentro de la seleccion. Las superficies fuera de ella se informan como area incompleta; recortes, canales saturados y falta de repeticion conservan motivos diferenciados. No se eliminaron los controles de movimiento, calidad ni falsos positivos por formas rectangulares. Un objeto de color/forma similar cercano al follaje sigue siendo un riesgo.

La nitidez relativa usa RMS de un Laplaciano de paso 2 sobre luminancia promediada en 3x3, dentro de la union foliar erosionada 4 pixeles. No mide foco optico, no es un porcentaje y depende de textura, exposicion, escala y segmentacion. Tiene menos peso del contorno y del ruido fino. La seleccion de foto mantiene prioridad por calidad, comparabilidad y evidencia repetida; usa detalle para desempatar en vez del puntaje general frecuentemente saturado. En una foto real con desenfoque progresivo sigma 0/1/2/4/12, el detalle descendio aproximadamente 3.72/2.97/2.03/1.21/0.50. Esto verifica sensibilidad al desenfoque sintetico, no calibra una distancia de foco ni garantiza detalle para insectos pequenos.

La vista amplificada ajusta ancho/alto independientemente sin deformar la imagen y conserva el modo de seleccion en coordenadas de imagen completa. Se corrigio una carrera: la region persistida se carga sin esperar la descarga asincrona de fotos. No se aplican filtros de realce artificial ni cambios de firmware.

Pruebas: 58 casos, con cuatro nuevos sinteticos de detalle/seleccion/crop y cinco reales nuevos: siete rafagas distintas de la tarde con recuperacion del amarillo, desenfoque progresivo, brillo 0.8-1.05, pequenas ganancias de canal y una nueva rafaga con fondo blanco (`mtrmp176`). Se conservan las pruebas de punta marron, sombras, agujeros, sobreexposicion y movimiento. Las distintas rafagas siguen siendo de una sola planta, no un conjunto independiente para estimar precision universal.

Prueba real desde la pagina: captura estable con una zona amarilla (33.52% de la superficie evaluada por la definicion anterior), una mancha repetida en la punta y detalle 3.32. Es salida del algoritmo, no severidad de enfermedad. Se verifico tambien un resultado no cuantitativo por movimiento, recarga persistente y movil 390x844 sin desbordamiento. Las fotos y el historial permanecen locales y no se alteraron fechas para las pruebas.

## Amarillamiento: 2026-09-07, v4.3

Se agrega una mascara independiente de regiones amarillo-ocre amplias proximas al follaje. Usa relaciones de canales tras la correccion limitada de blanco, apertura morfologica, superficie/forma y soporte temporal. Los agujeros no se rellenan; las regiones recortadas, saturadas o sin repeticion quedan candidatas. No se cambian los umbrales de manchas anteriores ni la mascara utilizada para comparar area a lo largo del tiempo. El rojo tiene prioridad visual en el solapamiento con amarillamiento.

Porcentaje: pixeles amarillentos repetidos / union de esos pixeles y mascara foliar previa. No equivale a proporcion enferma de la planta; no incluye superficies ocultas, excluidas o no evaluables, ni identifica causas. Los porcentajes de manchas y amarillo tienen denominadores diferentes y pueden solaparse: no deben sumarse. La cercania al follaje y la forma reducen distractores, pero no sustituyen una segmentacion semantica. Objetos amarillos cercanos con forma similar pueden dar falsos positivos. Sin suficiente follaje verde o detalle evaluable, la lectura puede ser nula. Verde no garantiza salud.

Validacion: 49 pruebas aprobadas, cero omitidas. Siete nuevos casos sinteticos cubren amarillo junto a verde y punta marron, sombras, agujeros, objeto rectangular amarillo, seleccion manual, saturacion, artefacto aislado, dos fotos positivas con una tercera limpia y variaciones de brillo. Dos pruebas locales nuevas usan el recorte del usuario (solo candidatos, no repeticion artificial de la misma imagen) y la rafaga independiente `plant-mtrckfe1-{1,2,3}.jpg`. Se conserva la deteccion de la punta en esa rafaga. Ambos ejemplos pertenecen a la misma planta: no constituyen validacion independiente de exactitud general.

Prueba desde la pagina con la seleccion guardada: una region amarillenta repetida, 24.37% del area definida arriba, junto con tres regiones de manchas y nueve candidatas del detector existente. Es la salida del algoritmo, no anotacion de verdad. Resultado persistente al recargar, vista movil 390x844 sin desbordamiento horizontal y flash apagado tras la prueba. El recorte queda local en `data/plant-captures/yellow-leaf-reference.png`, excluido de Git junto con las fotos.

## Actualizacion 2026-09-07

Version `leaf-pixel-v4.2`. Se conserva el detector por color y repeticion, con proteccion adicional para marcas cortadas por la seleccion manual y validacion de coordenadas normalizadas. Se incorpora el rango de area observado en las fotos comparables de cada rafaga.

La comparacion temporal ahora busca en el historial la referencia compatible mas reciente entre una hora y siete dias; una lectura fallida o demasiado reciente no oculta otras referencias validas. Exige misma version, seleccion numericamente equivalente, resolucion y protocolo/intensidad de luz, brillo similar y limites de desplazamiento/tamano. Las hojas que tocan el borde del encuadre o seleccion no generan una comparacion cuantitativa. Las imagenes compartidas o de una misma rafaga no son referencias independientes.

El intervalo observado de cambio es `[minActual - maxBase, maxActual - minBase]`. Solo se publica un cambio si todo el intervalo esta por encima de +0.5 pp o por debajo de -0.5 pp. Si no, la tendencia es "No concluyente" y el cambio numerico queda nulo, no cero. No es un intervalo estadistico ni una garantia contra movimientos de camara, cambios de postura o perdida de color verde. Las tolerancias son conservadoras y no estan calibradas sobre crecimiento fisico conocido.

Validacion ejecutada:

- 40 pruebas aprobadas, cero omitidas: las 28 anteriores, dos nuevas de seleccion/rango y diez de comparacion temporal. Incluyen multiples variantes de entradas invalidas, luces, versiones, fechas, encuadres y ruido. El corpus local y `sharp` estuvieron disponibles.
- Captura real de tres fotos desde "Analizar ahora", persistida y recuperada al recargar sin errores JavaScript. Area observada 6.32-6.36% de la imagen dentro de la seleccion guardada; dos regiones repetidas y tres candidatas. Es un resultado del algoritmo, no anotacion de verdad ni estimacion de exactitud.
- La seleccion guardada corta parte de la hoja: se verifico "Area recortada" y ausencia de numero de crecimiento. La foto actual contiene una hoja muy amarilla que no queda representada completamente por el porcentaje de manchas; se mantiene esta limitacion explicita.
- Revision de interfaz en escritorio y movil 390x844; sin desbordamiento horizontal. Restaurado el viewport normal y conservada la seleccion del usuario. Flash verificado en cero al finalizar.
- El seguimiento a lo largo de horas/dias se valido con casos sinteticos, no con una nueva serie temporal real de crecimiento. No se modificaron fechas del historial real para simularla.

## Metodo

Analisis local de tres JPEG QXGA, muestreados a 1024 px de ancho. Las hojas se delimitan por color y superficies conectadas; los tallos delgados se filtran por apertura y forma. El fondo se estima fuera de la vegetacion para reducir marcas dentro de agujeros. La desviacion de color se compara con el verde cercano, no solo con un umbral global. Una region requiere suficiente superficie, compacidad y repeticion para pasar de candidata a marca repetida.

La calidad se evalua sobre la superficie foliar: luz, canales saturados, detalle y cantidad de hoja visible. Es un filtro heuristico, no una probabilidad de exactitud. Tampoco distingue enfermedades, plagas, carencias nutricionales o dano mecanico.

## Pruebas ejecutadas

- 22 pruebas sinteticas/HTTP: hoja verde sin manchas, lesion marron, agujeros claros, sombra verde, variaciones de exposicion/color, region manual, falta de hojas, oscuridad, falta de textura, repeticion, artefacto aislado, movimiento, captura unica, una mancha visible en dos fotos con una tercera limpia, dos fotos estables con una tercera movida y entradas invalidas; parsing multipart fragmentado, JPEG truncado, limites de memoria, desconexion, calentamiento y restauracion de parametros ante errores.
- Seis pruebas con fotos locales: conservar la punta marron visible, incluida una rafaga posterior independiente de las usadas para el ajuste inicial; no convertir el frasco ni los agujeros anotados en marcas repetidas; tolerar cambios moderados de brillo; rechazar desenfoque fuerte y sobreexposicion; conservar la mancha al iniciar desde video con flash intenso.
- Pruebas de interfaz: seleccion manual y restablecimiento de region, comparacion con foto sin marcas, persistencia al recargar y viewport movil de 390x844 sin desbordamiento horizontal.
- Prueba de video con intensidad previa 96: el analisis usa 24 y despues se verifico la restauracion a intensidad 96, resolucion UXGA (15) y compresion 10. Al finalizar las pruebas se apago el flash.
- Solicitudes simultaneas: una captura de tres fotos se completa y la segunda se rechaza sin modificar ajustes. El servidor comunica la pausa a las otras vistas para recuperar el video.
- Inspeccion automatica de 70 capturas historicas y de ensayo. Esto comprueba ejecucion y permite revisar mascaras; no constituye una medicion de precision sobre 70 fotos etiquetadas.
- Ensayo de flash 24, 48 y 96, tres fotos por intensidad, con restauracion de ajustes comprobada. El flash 96 produjo saturacion de canales en esta escena. Se adopto 24 como punto de partida configurable.
- Prueba real desde la pagina: rafaga de tres fotos, una zona repetida en la punta deteriorada y candidatas inciertas en bordes. El porcentaje es superficie marcada respecto de la hoja segmentada, no severidad diagnosticada.

Las fotos, mascaras y resultados detallados quedan en `data/plant-captures/` y `data/vision-validation/`, excluidos de Git. El runner opcional `tests/capture-lighting.js` requiere `CAMERA_TEST_URL` y que no haya otro consumidor de video activo. Modifica temporalmente la camara y restaura los ajustes.

## Limites conocidos

- La prueba real corresponde a una planta/escena. No hay un conjunto independiente de cultivos etiquetados que permita prometer exactitud universal.
- Manchas muy pequenas, pigmentacion natural, reflejos, hojas superpuestas, lesiones completamente marrones y fondos del mismo color pueden producir omisiones o candidatas falsas. Las formas finas se muestran como inciertas.
- La falta de foco fisico no se repara aumentando resolucion. El filtro de nitidez puede detectar deterioro fuerte, pero no garantiza detalle suficiente para insectos pequenos.
- La region manual queda ligada al encuadre. Hay que restablecerla al mover la camara o cambiar la planta.
- La comparacion de area no tiene una escala fisica y se suspende cuando cambian region, luz, version, encuadre o calidad. El resultado no debe interpretarse como crecimiento medido de la planta.

Contexto del buffer y modo de captura: [driver oficial de Espressif](https://github.com/espressif/esp32-camera#general-information).
