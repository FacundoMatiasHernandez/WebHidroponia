# Validacion de manchas foliares

Fecha: 2026-09-04. Version del analisis: `leaf-pixel-v4.1`.

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
