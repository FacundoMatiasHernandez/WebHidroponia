# HydroVision

Dashboard web para monitoreo de una huerta hidroponica con ESP32-S3, ESP32-CAM y analisis visual del cultivo.

## Empezar en otra PC

Guia actualizada: [Instalacion y transferencia](app/docs/new-notebook-setup.md).
Para compartir: [Guia PDF](output/pdf/HydroVision_Guia_Companero.pdf) y
[prompt para el asistente de tu companero](PROMPT_PARA_COMPANERO.md).

Para obtener la interfaz sin configurar hardware:

```powershell
git clone https://github.com/FacundoMatiasHernandez/WebHidroponia.git
cd WebHidroponia
node server.js
```

Abrir http://localhost:4173/. Requiere Node.js 24; no necesita npm install.
Sin placas no hay datos inventados. Para ver la instalacion existente desde
otra pantalla, usar la IP de su PC servidora en lugar de iniciar otro servidor.
El firmware de cuatro bombas es `firmware/tesis_huerta_j17_wifi_v3/`;
la cuarta salida esta en GPIO41, no GPIO42.

## Panel de operacion

La interfaz esta organizada en Resumen, Bombas, Camara, Tendencias y Equipo.
En dispositivos moviles, la navegacion se encuentra en la barra inferior.
El resumen agrupa ambiente, solucion nutritiva y niveles; las observaciones
son actuales y no repiten una alarma por cada muestra recibida.

El servidor inicia esperando datos reales, incluso sin DATA_MODE.
No genera mediciones de demostracion ni las recupera de archivos antiguos.
Una lectura ausente, invalida o vencida aparece sin valor; la EC estimada
y el TDS sin calibrar conservan su advertencia. Los intervalos de referencia
son los configurados, no una validacion agronomica para cualquier cultivo.

Las bombas muestran el estado electrico confirmado por la ESP32, no caudal.
El encendido requiere confirmacion; el continuo exige ademas aceptar la
supervision de la dosis. No cambian las protecciones ni el protocolo de control.
Los resultados del laboratorio con tablet no aparecen como diagnosticos del
cultivo. Con CAMERA_CAPTURE_TARGET=screen, el analisis de plantas de la interfaz
de operacion permanece deshabilitado. El laboratorio se conserva por separado.
Las tipografias se sirven localmente, sin depender de servicios de fuentes externos.

## Laboratorio con tablet sincronizada

Con `CAMERA_CAPTURE_TARGET=screen`, abrir en la PC
`http://localhost:4173/simulador/control`. El panel muestra el enlace local
que debe abrirse en la tablet; tocar **Iniciar pantalla** y elegirla en el panel.
Desde la PC se controlan los seis tipos de plagas, amarillo, fondo, escala,
giro, dia y carta de enfoque. Las capturas esperan una confirmacion reciente
de la pantalla y conservan el caso exacto junto a las tres fotos.
No hace falta Codex en la tablet. Se conserva el sitio publicado original.
Guia y protocolo: [Simulador local](app/simulator/README.md).

## Continuar desde otra notebook

Guia completa: [Instalacion y traslado a otra PC](app/docs/new-notebook-setup.md).

Con Git y Node.js 24 instalados, desde PowerShell:

```powershell
git clone https://github.com/FacundoMatiasHernandez/WebHidroponia.git
cd WebHidroponia
Copy-Item .env.camera.example .env.camera.local
# Editar CAMERA_MJPEG_URL si cambio la IP de la ESP32-CAM.
npm run start:camera
```

Abrir `http://localhost:4173/`. No hacen falta dependencias npm para ejecutar
la web. Para trabajar sin camara: `npm start`.

La plantilla de camara conserva QXGA y usa compresion 12 para foto y analisis,
el ajuste local probado tras errores `FB-OVF`. El video mantiene su perfil.
`npm start` no carga `.env.camera.local`; usar `npm run start:camera` para ello.

La ESP32-S3 J17 envia datos a `WEB_INGEST_URL` grabado en su firmware: al cambiar de PC
hay que actualizar esa direccion si cambia la IP del servidor. Las fotos,
el historial y las credenciales son locales y no viajan con `git clone`.

Documentos incluidos (edicion de septiembre de 2026, anterior al ajuste local
de compresion de octubre):

- [Documentacion tecnica integral](output/pdf/HydroVision_Documentacion_Tecnica_Integral.pdf).
- [Mapa conceptual](output/pdf/HydroVision_Mapa_Conceptual.pdf).

## Que incluye

- Vista general de sensores ambientales y de agua.
- Ingesta real por HTTP desde la ESP32-S3.
- Historico reciente de las ultimas 40 muestras por sensor.
- Sistema de alarmas con severidad `warning` y `critical`.
- Canal de camara ESP32-CAM con imagen HD y video MJPEG.
- Analisis de manchas por pixel, seleccion de hoja, control de calidad y comparacion de tres fotos con luz estabilizada.
- Estados explicitos de desconexion, calibracion pendiente y lectura no disponible.

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

Las marcas rojas corresponden a regiones de color que se repiten y tienen suficiente superficie. Las celestes son candidatas inciertas y el naranja oscuro indica amarillamiento repetido. No se diagnostican plagas ni se presenta un porcentaje de certeza medica/agronomica. Una foto sin calidad suficiente produce un resultado no evaluable, no un resultado saludable.

El cambio de area se expresa en puntos porcentuales. Busca la referencia compatible mas reciente del historial, entre una hora y siete dias de antiguedad, con la misma region, version, resolucion y protocolo de luz. Descarta hojas cortadas por la seleccion o el encuadre, cambios de iluminacion/posicion y fotos de la misma rafaga. Compara los rangos de area observados en las fotos estables de cada rafaga: si la diferencia no supera esa variacion y un margen de 0.5 puntos porcentuales, indica "No concluyente" y no informa un numero de crecimiento. El rango es repetibilidad observada, no un intervalo de confianza estadistico. No equivale a crecimiento fisico medido en centimetros; cambios de postura o color tambien pueden alterar el area segmentada.

Las marcas cortadas por el borde de una seleccion manual quedan como candidatas por revisar. La version `leaf-pixel-v4.4` requiere capturas evaluadas con esta version para comparar areas; los resultados anteriores se conservan, pero no se mezclan como referencias compatibles.

`Detalle hoja` mide detalle fino dentro de las superficies foliares tras un suavizado limitado que reduce la influencia del ruido. Es una medida relativa, no porcentaje, distancia de enfoque ni autofocus. Entre fotos comparables con evidencia repetida, se prioriza este detalle en lugar de depender del puntaje general de calidad, que podia saturarse en 95. La ampliacion conserva las proporciones y ajusta ancho y alto por separado para mostrar menos fondo. No se aplica enfoque artificial a los pixeles analizados ni se mueve la lente.

El amarillo utiliza el contexto verde previo a la reconstruccion restrictiva, con soporte de proximidad limitado por el borde de la region, no por una fraccion fija de toda una hoja grande. Detecta regiones completas antes de aplicar la seleccion manual: si esta las corta o deja fuera, informa area incompleta; si se saturan los canales, informa exceso de luz. Esas advertencias no se presentan como ausencia de amarillo. La seleccion persistida se restaura antes de cargar las fotos para evitar que una captura inmediata la pierda.

El amarillamiento se evalua por separado: superficies amplias amarillo-ocre, con forma compatible y cercanas al follaje segmentado, repetidas en al menos dos fotos comparables. No depende de que toda la hoja siga siendo verde. Se muestra en naranja oscuro; las manchas conservan el rojo y las candidatas inciertas aparecen en celeste. El porcentaje usa la union del follaje segmentado y las superficies amarillentas repetidas, sin duplicar pixeles; no es porcentaje de enfermedad. Las mascaras pueden solaparse y sus porcentajes no se suman. El area usada para comparar crecimiento mantiene su segmentacion previa, sin incorporar automaticamente toda superficie amarilla.

Es un filtro de color/forma, no identificacion semantica de hojas ni diagnostico: un objeto amarillo similar cerca del follaje puede confundirse, y tejido muy palido, marron oscuro o una planta sin suficiente verde visible puede quedar fuera o no ser evaluable. Verde visible tampoco garantiza salud.

## Pruebas de vision

```bash
node --test tests/*.test.js
```

Las pruebas sinteticas y HTTP no requieren dependencias. Las trece pruebas de fotos reales/referencia necesitan `sharp` y el corpus local, excluido de Git; se omiten explicitamente cuando no estan disponibles. `node tests/inspect-captures.js` procesa ese corpus y genera mascaras en `data/vision-validation/`. `node tests/audit-vision-history.js 14` reproduce las ultimas 14 entradas y muestra motivos de descarte sin cambiar el historial. Detalles y limites en `app/docs/plant-vision-validation.md`.

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
- `app/scripts/charts.js`: graficos de mediciones con marcas de tiempo reales y cortes de adquisicion.
- `app/scripts/operations.js`: presentacion de lecturas, estados y resumen operativo.
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

## ESP32-S3 por Wi-Fi y bombas

El firmware J17 integrado tambien puede enviar todas sus lecturas por Wi-Fi,
sin el lector USB. El dashboard permite pulsos manuales individuales de las
cuatro bombas peristalticas con firmware v3 y muestra el estado confirmado por la ESP32.
Incluye pulsos de hasta 10 segundos o modo continuo manual, interbloqueo entre
bombas, apagado de todas y ordenes con vencimiento. El modo continuo conserva
el corte local tras 30 segundos sin servidor. No realiza dosificacion automatica.

Inicio local: `npm run start:wifi`, con `.env.wifi.local` configurado.
Guia: [Wi-Fi y bombas](app/docs/esp32-wifi-control.md).
La PC del servidor debe permanecer encendida; la ESP32 necesita alimentacion
independiente si se retira su USB de la PC.
