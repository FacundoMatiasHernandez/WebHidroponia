# HydroVision

Dashboard web para monitoreo de una huerta hidroponica con ESP32-S3, ESP32-CAM y analisis visual del cultivo.

## Que incluye

- Vista general de sensores ambientales y de agua.
- Ingesta real por HTTP desde la ESP32-S3.
- Historico reciente de las ultimas 40 muestras por sensor.
- Sistema de alarmas con severidad `warning` y `critical`.
- Canal de camara ESP32-CAM con imagen HD y video MJPEG.
- Analisis de manchas por pixel, seleccion de hoja, control de calidad y comparacion de tres fotos con luz estabilizada.
- Modo mock para probar la interfaz sin hardware conectado.

## Arquitectura actual

```text
ESP32-S3 sensores -> POST /api/ingest/batch -> backend Node -> dashboard web
ESP32-CAM OV3660 -> /capture y /stream -> backend Node -> dashboard web
```

## Ejecucion local

El proyecto corre con un backend Node nativo, sin dependencias externas.

```bash
node server.js
```

Luego abrir:

```text
http://localhost:4173
```

Para configurar la camara:

```powershell
$env:CAMERA_MJPEG_URL = "http://<ESP32_CAM_IP>:81/stream"
$env:CAMERA_LABEL = "ESP32-CAM OV3660"
node server.js
```

`POST /api/plant-vision/capture` obtiene tres JPEG de una rafaga QXGA con flash suave (`CAMERA_ANALYSIS_FLASH_INTENSITY=24`). Descarta al menos seis fotogramas y espera al menos dos segundos antes de conservar las fotos. Restaura flash, resolucion, compresion y ajustes de color al terminar, incluso ante errores. El video se pausa durante la captura y luego se recupera.

La compresion predeterminada de foto y analisis es 8. La compresion anterior de 4 produjo cortes al fotografiar esta escena con menos flash. La resolucion se mantiene en 2048x1536; `CAMERA_ANALYSIS_JPEG_QUALITY` admite valores de 8 a 63.

Las marcas rojas corresponden a regiones de color que se repiten y tienen suficiente superficie. Las amarillas son candidatas inciertas. No se diagnostican plagas ni se presenta un porcentaje de certeza medica/agronomica. Una foto sin calidad suficiente produce un resultado no evaluable, no un resultado saludable.

El cambio de area se expresa en puntos porcentuales. Busca la referencia compatible mas reciente del historial, entre una hora y siete dias de antiguedad, con la misma region, version, resolucion y protocolo de luz. Descarta hojas cortadas por la seleccion o el encuadre, cambios de iluminacion/posicion y fotos de la misma rafaga. Compara los rangos de area observados en las fotos estables de cada rafaga: si la diferencia no supera esa variacion y un margen de 0.5 puntos porcentuales, indica "No concluyente" y no informa un numero de crecimiento. El rango es repetibilidad observada, no un intervalo de confianza estadistico. No equivale a crecimiento fisico medido en centimetros; cambios de postura o color tambien pueden alterar el area segmentada.

Las marcas cortadas por el borde de una seleccion manual quedan como candidatas por revisar. La version `leaf-pixel-v4.3` requiere capturas evaluadas con esta version para comparar areas; los resultados anteriores se conservan, pero no se mezclan como referencias compatibles.

El amarillamiento se evalua por separado: superficies amplias amarillo-ocre, con forma compatible y cercanas al follaje segmentado, repetidas en al menos dos fotos comparables. No depende de que toda la hoja siga siendo verde. Se muestra en naranja oscuro; las manchas conservan el rojo y las candidatas inciertas aparecen en celeste. El porcentaje usa la union del follaje segmentado y las superficies amarillentas repetidas, sin duplicar pixeles; no es porcentaje de enfermedad. Las mascaras pueden solaparse y sus porcentajes no se suman. El area usada para comparar crecimiento mantiene su segmentacion previa, sin incorporar automaticamente toda superficie amarilla.

Es un filtro de color/forma, no identificacion semantica de hojas ni diagnostico: un objeto amarillo similar cerca del follaje puede confundirse, y tejido muy palido, marron oscuro o una planta sin suficiente verde visible puede quedar fuera o no ser evaluable. Verde visible tampoco garantiza salud.

## Pruebas de vision

```bash
node --test tests/*.test.js
```

Las pruebas sinteticas y HTTP no requieren dependencias. Las ocho pruebas de fotos reales/referencia necesitan `sharp` y el corpus local, excluido de Git; se omiten explicitamente cuando no estan disponibles. `node tests/inspect-captures.js` procesa ese corpus y genera mascaras en `data/vision-validation/`. Detalles y limites en `app/docs/plant-vision-validation.md`.

Si queres reiniciar el estado persistido:

```bash
node -e "require('fs').rmSync('data/runtime-state.json',{force:true})"
```

## Endpoints principales

- `GET /api/bootstrap`
- `GET /api/camera/capture`
- `GET /api/camera/stream`
- `POST /api/ingest/batch`
- `POST /api/plant-vision/capture`
- `POST /api/plant-vision/analysis`

## Estructura

- `index.html`: layout principal del dashboard.
- `server.js`: backend HTTP, SSE, persistencia, camara y capturas.
- `app/styles/main.css`: sistema visual responsive.
- `app/scripts/charts.js`: render de graficos y camara simulada.
- `app/scripts/app.js`: cliente, seleccion de hoja, visualizacion y comparacion historica.
- `app/scripts/plant-vision.js`: segmentacion foliar, manchas, calidad y repetibilidad; reutilizable en navegador y pruebas Node.
- `app/scripts/plant-trends.js`: comparacion historica de area con controles de compatibilidad y variacion de rafaga.
- `app/camera-burst.js`: captura multipart acotada y restauracion de parametros de camara.
- `app/docs/esp32-direct-setup.md`: guia de conexion directa de sensores.
- `firmware/esp32_web_direct`: firmware de sensores.
- `firmware/esp32_cam_webserver`: firmware de la ESP32-CAM.

## Archivos locales

No versionar:

- `firmware/**/secrets.h`
- `data/runtime-state.json`
- `data/plant-captures/`

Usar los archivos `.example` como plantilla para configurar WiFi e IP local.
