# ESP32 directa a WebHidroponia

Arquitectura final actual:

```text
ESP32 con sensores -> POST /api/ingest/batch -> backend Node -> dashboard web
```

El backend ya tiene el endpoint `POST /api/ingest/batch` para recibir lecturas directas.

Payload minimo:

```json
{
  "source": "esp32-direct",
  "readings": [
    { "sensorId": "air-temperature", "value": 17.7 },
    { "sensorId": "air-humidity", "value": 46.0 },
    { "sensorId": "water-level", "value": 4 }
  ]
}
```

Firmware:

```text
firmware/esp32_web_direct/esp32_web_direct.ino
```

La configuracion WiFi no se versiona. Copiar:

```text
firmware/esp32_web_direct/secrets.h.example
```

como:

```text
firmware/esp32_web_direct/secrets.h
```

y completar SSID, clave e IP de la PC que corre la web.
