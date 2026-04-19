# Plan de integración de hardware

## Objetivo

Usar este dashboard como frontend estable, manteniendo la interfaz mientras se reemplazan los mocks por datos reales provenientes de PLCnext, ESP32 y Raspberry Pi.

## Arquitectura recomendada

```text
ESP32 (sensores) ----\
                      \             +----------------------+
                       +-- MQTT --->| Raspberry Pi Gateway |--- HTTP/WebSocket ---> Dashboard
PLCnext (actuadores) --/            +----------------------+
                                      |
                                      +--- Cámara Logitech C922
```

## Responsabilidades por componente

### ESP32

- Leer sensores analógicos y digitales.
- Publicar mediciones en MQTT.
- Posibles temas:
  - `huerta/sensores/ambiente/humedad`
  - `huerta/sensores/ambiente/temperatura`
  - `huerta/sensores/ambiente/co2`
  - `huerta/sensores/agua/nivel`
  - `huerta/sensores/agua/temperatura`
  - `huerta/sensores/agua/ph`
  - `huerta/sensores/agua/ec`
  - `huerta/sensores/luz/intensidad`

### PLC Phoenix Contact PLCnext

- Ejecutar control de actuadores críticos.
- Exponer estados de bomba, válvulas, luces y alarmas duras.
- Integración sugerida:
  - MQTT si querés una capa uniforme
  - OPC UA si querés una interfaz industrial más formal

### Raspberry Pi

- Broker MQTT con Mosquitto.
- Adaptador que normaliza payloads.
- Backend HTTP/WebSocket o SSE para el dashboard.
- Video de la Logitech C922:
  - Etapa 1: MJPEG
  - Etapa 2: HLS
  - Etapa 3: WebRTC si necesitás menor latencia

## Contrato JSON sugerido

```json
{
  "sensorId": "water-temperature",
  "label": "Temperatura del agua",
  "value": 21.4,
  "unit": "°C",
  "status": "ok",
  "timestamp": "2026-03-16T20:00:00Z",
  "source": "esp32",
  "channel": "huerta/sensores/agua/temperatura"
}
```

## Eventos del dashboard

### Snapshot completo

```json
{
  "snapshot": {
    "water-ph": { "sensorId": "water-ph", "value": 6.12, "status": "ok" }
  },
  "history": {
    "water-ph": [{ "value": 6.04 }, { "value": 6.09 }, { "value": 6.12 }]
  },
  "alarms": [],
  "updatedAt": "2026-03-16T20:00:00Z",
  "running": true
}
```

## Migración propuesta

1. Mantener el frontend actual.
2. Crear un backend en Raspberry Pi que entregue el mismo `snapshot`.
3. Sustituir `HydroponicMockEngine` por un cliente de WebSocket/SSE.
4. Conectar cámara real al contenedor del dashboard.
5. Agregar control manual y registro histórico persistente.
