# ESP32 directo a WebHidroponia

Este firmware envia lecturas reales de sensores al backend web.

Flujo:

```text
ESP32 -> POST /api/ingest/batch -> WebHidroponia -> dashboard SSE
```

Sensores soportados:

- DHT11 en GPIO 4 -> `air-temperature` y `air-humidity`
- HC-SR04 TRIG GPIO 5, ECHO GPIO 6 -> `water-level`
- Sensor de agua analogico GPIO 7 -> respaldo de `water-level`
- pH opcional, desactivado por defecto

Preparacion:

1. Copiar `secrets.h.example` como `secrets.h`.
2. Completar WiFi y la IP de la PC que corre el dashboard.
3. Ejecutar la web con `npm start`.
4. Cargar `esp32_web_direct.ino` en la ESP32-S3.

Endpoint usado:

```text
http://<WEB_HOST>:4173/api/ingest/batch
```

Si cambia la IP WiFi de la PC, actualizar `WEB_HOST` en `secrets.h`.
