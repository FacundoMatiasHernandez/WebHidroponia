# ESP32-CAM MJPEG para WebHidroponia

Firmware basado en el ejemplo `CameraWebServer` del core Arduino ESP32.

La configuracion de arranque usa un perfil estable para video continuo:

```cpp
const framesize_t STREAM_FRAME_SIZE = FRAMESIZE_UXGA;  // 1600x1200 para MJPEG
const int STREAM_JPEG_QUALITY = 10;
```

El backend de WebHidroponia cambia automaticamente el perfil cuando corresponde:

- Imagen HD: `FRAMESIZE_QXGA` / `2048x1536`, actualizada cada 1 hora o al presionar el boton manual.
- Video en vivo: `FRAMESIZE_UXGA` / `1600x1200`, estable para MJPEG continuo.

URLs expuestas por la camara:

```text
http://<ESP32_CAM_IP>/
http://<ESP32_CAM_IP>/capture
http://<ESP32_CAM_IP>:81/stream
```

Para conectar la web, iniciar el servidor con:

```powershell
$env:CAMERA_MJPEG_URL = "http://<ESP32_CAM_IP>:81/stream"
$env:CAMERA_LABEL = "ESP32-CAM OV3660"
npm start
```

Preparacion del sketch:

1. Copiar el ejemplo `CameraWebServer` del paquete Arduino ESP32.
2. Reemplazar el `.ino` por `esp32_cam_webserver.ino`.
3. Usar `board_config.h` con `CAMERA_MODEL_AI_THINKER`.
4. Copiar `secrets.h.example` como `secrets.h` y completar WiFi.
5. Cargar en la placa `AI Thinker ESP32-CAM`.

Variables opcionales del servidor:

El firmware de este repositorio expone `sharpness` y `denoise` por `/control`.
Para usarlos, cargar esta version de `app_httpd.cpp` en la camara. El servidor
no envia esos controles a firmware antiguo salvo que se configuren explicitamente:
`CAMERA_STILL_SHARPNESS`, `CAMERA_VIDEO_SHARPNESS` (-3 a 3) y
`CAMERA_STILL_DENOISE`, `CAMERA_VIDEO_DENOISE` (0 a 8).
Nitidez digital no equivale a autofocus: el controlador OV3660 no tiene soporte
de autofocus. Usar valores moderados para no inventar contornos sobre las hojas.

En la prueba local con tablet se dejo QXGA, calidad 10, `ae_level=-3`,
`sharpness=2` y flash cero. Activar `denoise=1` provoco capturas HTTP 500;
se verifico la recuperacion con `denoise=0`. No habilitar ese filtro sin
probar foto y rafaga en el hardware concreto. Los reflejos de la pantalla
y el foco del lente siguen siendo limitaciones fisicas.

- `CAMERA_STILL_FRAMESIZE=19`
- `CAMERA_STILL_QUALITY=8`
- `CAMERA_VIDEO_FRAMESIZE=15`
- `CAMERA_VIDEO_QUALITY=10`
- `CAMERA_CAPTURE_REFRESH_MS=3600000`
- `CAMERA_ANALYSIS_FLASH_INTENSITY=24`
- `CAMERA_ANALYSIS_JPEG_QUALITY=8`
- `CAMERA_ANALYSIS_FLASH_SETTLE_MS=250`
- `CAMERA_STILL_BRIGHTNESS=0`
- `CAMERA_STILL_CONTRAST=1`
- `CAMERA_STILL_SATURATION=0`
- `CAMERA_STILL_AE_LEVEL=-1`

Notas de calidad:

- `FRAMESIZE_QXGA` con `quality=8` fue estable en las rafagas probadas. `quality=4` produjo cortes con menos flash; no usarlo como ajuste general de analisis.
- `quality=3` daba aun menos compresion, pero la camara respondia con errores `500`.
- El video continuo conserva UXGA. El analisis abre un stream QXGA temporal, descarta seis fotogramas y espera al menos dos segundos para que el LED y la exposicion se estabilicen. Conserva tres fotos y cierra el stream.
- Configurar `led_intensity` no enciende por si solo el LED cuando no hay video: el firmware lo enciende dentro de los handlers de captura/stream. La rafaga usa el stream para mantener la luz durante el calentamiento.
- El backend pausa los consumidores de video y restaura todos los ajustes modificados, incluida la intensidad previa, al terminar. Si la restauracion falla dos veces, muestra el error en lugar de afirmar que se completo.
- No hace falta reflashear esta version del firmware para utilizar la rafaga.
- La mejora mas grande fuera del codigo suele venir de buena iluminacion, foco manual del lente y WiFi estable.
