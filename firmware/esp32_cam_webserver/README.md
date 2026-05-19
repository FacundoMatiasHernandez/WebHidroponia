# ESP32-CAM MJPEG para WebHidroponia

Firmware basado en el ejemplo `CameraWebServer` del core Arduino ESP32.

La configuracion usada para la huerta prioriza detalle sobre FPS:

```cpp
const framesize_t STREAM_FRAME_SIZE = FRAMESIZE_UXGA;  // 1600x1200
const int STREAM_JPEG_QUALITY = 10;                    // Maximo estable probado
```

URLs expuestas por la camara:

```text
http://<ESP32_CAM_IP>/
http://<ESP32_CAM_IP>/capture
http://<ESP32_CAM_IP>:81/stream
```

Para conectar la web, iniciar el servidor con:

```powershell
$env:CAMERA_MJPEG_URL = "http://<ESP32_CAM_IP>:81/stream"
$env:CAMERA_LABEL = "ESP32-CAM OV2640"
npm start
```

Preparacion del sketch:

1. Copiar el ejemplo `CameraWebServer` del paquete Arduino ESP32.
2. Reemplazar el `.ino` por `esp32_cam_webserver.ino`.
3. Usar `board_config.h` con `CAMERA_MODEL_AI_THINKER`.
4. Copiar `secrets.h.example` como `secrets.h` y completar WiFi.
5. Cargar en la placa `AI Thinker ESP32-CAM`.

Notas de calidad:

- `FRAMESIZE_UXGA` con `quality=10` fue estable en la placa probada.
- `quality=8` o menor daria mas calidad teorica, pero la camara respondia con errores `500`.
- La mejora mas grande fuera del codigo suele venir de buena iluminacion, foco manual del lente y WiFi estable.
