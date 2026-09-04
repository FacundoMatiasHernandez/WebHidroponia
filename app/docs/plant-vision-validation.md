# Validacion de manchas foliares

Fecha: 2026-09-04. Version del analisis: `leaf-pixel-v4.1`.

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
