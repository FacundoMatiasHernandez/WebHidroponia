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

- `CAMERA_STILL_FRAMESIZE=19`
- `CAMERA_STILL_QUALITY=4`
- `CAMERA_VIDEO_FRAMESIZE=15`
- `CAMERA_VIDEO_QUALITY=10`
- `CAMERA_CAPTURE_REFRESH_MS=3600000`
- `CAMERA_ANALYSIS_FLASH_INTENSITY=96`
- `CAMERA_ANALYSIS_FLASH_SETTLE_MS=250`
- `CAMERA_STILL_BRIGHTNESS=0`
- `CAMERA_STILL_CONTRAST=1`
- `CAMERA_STILL_SATURATION=0`
- `CAMERA_STILL_AE_LEVEL=-1`

Notas de calidad:

- `FRAMESIZE_QXGA` con `quality=4` fue estable para captura fija y reduce la compresion.
- `quality=3` daba aun menos compresion, pero la camara respondia con errores `500`.
- `FRAMESIZE_FHD` y `FRAMESIZE_QXGA` no fueron estables para MJPEG continuo en la placa probada.
- La captura de analisis puede usar el flash aunque la imagen principal este en modo foto sin luz. El backend restaura la intensidad previa al terminar.
- La mejora mas grande fuera del codigo suele venir de buena iluminacion, foco manual del lente y WiFi estable.
