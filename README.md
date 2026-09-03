# HydroVision

Dashboard web para monitoreo de una huerta hidroponica con ESP32-S3, ESP32-CAM y analisis visual del cultivo.

## Que incluye

- Vista general de sensores ambientales y de agua.
- Ingesta real por HTTP desde la ESP32-S3.
- Historico reciente de las ultimas 40 muestras por sensor.
- Sistema de alarmas con severidad `warning` y `critical`.
- Canal de camara ESP32-CAM con imagen HD y video MJPEG.
- Analisis visual inicial para estimar area vegetal, crecimiento y manchas.
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
- `app/scripts/app.js`: cliente que consume API, SSE y analiza capturas con Canvas.
- `app/docs/esp32-direct-setup.md`: guia de conexion directa de sensores.
- `firmware/esp32_web_direct`: firmware de sensores.
- `firmware/esp32_cam_webserver`: firmware de la ESP32-CAM.

## Archivos locales

No versionar:

- `firmware/**/secrets.h`
- `data/runtime-state.json`
- `data/plant-captures/`

Usar los archivos `.example` como plantilla para configurar WiFi e IP local.
