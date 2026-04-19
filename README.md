# HydroVision

Dashboard web para monitoreo de una huerta hidropónica. El proyecto arranca con datos mockeados en tiempo real para validar interfaz, alarmas, históricos y video antes de integrar PLCnext, ESP32 y Raspberry Pi.

## Qué incluye

- Vista general de 8 sensores clave.
- Simulación en tiempo real con persistencia en archivo local del servidor.
- Histórico visual de las últimas 40 muestras por sensor.
- Sistema de alarmas con severidad `warning` y `critical`.
- Canal de cámara simulado, listo para reemplazar por video real desde Raspberry Pi.
- Arquitectura y contratos de datos preparados para una integración posterior.

## Sensores contemplados

- Humedad de ambiente
- Temperatura ambiente
- Nivel del agua
- CO2 en ambiente
- Temperatura del agua
- pH del agua
- Intensidad lumínica
- Conductividad eléctrica

## Ejecución local

El proyecto corre con un backend Node nativo, sin dependencias externas.

```bash
npm start
```

Luego abrí:

`http://localhost:4173`

Si querés reiniciar el estado persistido:

```bash
npm run reset-data
```

## Estructura

- `index.html`: layout principal del dashboard.
- `server.js`: backend HTTP, SSE, persistencia y control mock.
- `app/styles/main.css`: sistema visual responsive.
- `app/scripts/charts.js`: render de gráficos y stream simulado.
- `app/scripts/app.js`: cliente que consume API y SSE.
- `app/docs/integration-plan.md`: plan técnico para conectar hardware real.
- `data/runtime-state.json`: estado persistido por el servidor.

## Integración futura

La idea es conservar el mismo contrato de datos y reemplazar el origen:

1. Hoy: `source = "mock-backend"`.
2. Luego: `source = "esp32"`, `source = "plcnext"` o `source = "raspberry-gateway"`.
3. El frontend no cambia si el backend respeta el payload definido.

## Próximos pasos sugeridos

1. Implementar un gateway en Raspberry Pi que publique datos por MQTT.
2. Añadir un backend liviano que exponga WebSocket o SSE al dashboard.
3. Reemplazar la simulación de cámara por un stream MJPEG o HLS de la Logitech C922.
4. Incorporar autenticación y control manual de actuadores.
