# Integración real: PLCnext AXC F 2152 + MQTT + Node-RED

## Objetivo

Usar el dashboard actual con datos reales del PLC Phoenix Contact AXC F 2152, manteniendo el frontend y reemplazando la simulación por una ingesta desde Node-RED.

## Arquitectura recomendada

```text
PLCnext AXC F 2152 -> MQTT broker -> Node-RED -> HTTP POST -> HydroVision
                                              |
                                              +-> /api/ingest/reading
                                              +-> /api/ingest/batch
```

## Mapeo recomendado de variables

| Variable PLC | Topic MQTT | sensorId dashboard |
| --- | --- | --- |
| `GVL_Hydro.AirHumidity` | `huerta/sensores/ambiente/humedad` | `air-humidity` |
| `GVL_Hydro.AirTemperature` | `huerta/sensores/ambiente/temperatura` | `air-temperature` |
| `GVL_Hydro.WaterLevel` | `huerta/sensores/agua/nivel` | `water-level` |
| `GVL_Hydro.AirCo2` | `huerta/sensores/ambiente/co2` | `air-co2` |
| `GVL_Hydro.WaterTemperature` | `huerta/sensores/agua/temperatura` | `water-temperature` |
| `GVL_Hydro.WaterPh` | `huerta/sensores/agua/ph` | `water-ph` |
| `GVL_Hydro.LightIntensity` | `huerta/sensores/luz/intensidad` | `light-intensity` |
| `GVL_Hydro.WaterEc` | `huerta/sensores/agua/ec` | `water-ec` |

## Backend del dashboard

El backend ya quedó preparado para recibir datos reales:

- `POST /api/ingest/reading`
- `POST /api/ingest/batch`
- `GET /api/integration/topics`

### Payload mínimo para una lectura

```json
{
  "sensorId": "water-temperature",
  "value": 21.4,
  "timestamp": "2026-03-23T18:30:00Z",
  "source": "plcnext-node-red"
}
```

También podés usar `topic` en lugar de `sensorId`:

```json
{
  "topic": "huerta/sensores/agua/temperatura",
  "value": 21.4,
  "source": "plcnext-node-red"
}
```

### Payload batch

```json
{
  "source": "plcnext-node-red",
  "readings": [
    { "sensorId": "air-humidity", "value": 66.2 },
    { "sensorId": "water-ph", "value": 6.08 }
  ],
  "actuators": [
    { "id": "pump", "label": "Bomba", "active": true, "detail": "Estado real informado por PLC" }
  ]
}
```

## Token opcional para la ingesta

Si querés proteger la ingesta:

```powershell
$env:INGEST_TOKEN = "cambia-este-token"
npm start
```

Node-RED tiene que enviar el mismo valor en el header `x-ingest-token`.

## Flujo Node-RED recomendado

### Nodos

1. `mqtt in`
2. `function`
3. `http request`
4. `debug` opcional

### Topic del nodo MQTT

```text
huerta/sensores/#
```

### Código del nodo `function`

```javascript
const topicMap = {
  "huerta/sensores/ambiente/humedad": "air-humidity",
  "huerta/sensores/ambiente/temperatura": "air-temperature",
  "huerta/sensores/agua/nivel": "water-level",
  "huerta/sensores/ambiente/co2": "air-co2",
  "huerta/sensores/agua/temperatura": "water-temperature",
  "huerta/sensores/agua/ph": "water-ph",
  "huerta/sensores/luz/intensidad": "light-intensity",
  "huerta/sensores/agua/ec": "water-ec"
};

const sensorId = topicMap[msg.topic];
if (!sensorId) {
  return null;
}

let raw = msg.payload;

if (typeof raw === "string") {
  try {
    raw = JSON.parse(raw);
  } catch (error) {
    // Se mantiene como valor simple
  }
}

let value = raw;
let timestamp = new Date().toISOString();

if (raw && typeof raw === "object") {
  value = raw.value ?? raw.payload ?? raw.reading ?? raw.data;
  timestamp = raw.timestamp ?? raw.ts ?? timestamp;
}

value = Number(value);
if (!Number.isFinite(value)) {
  return null;
}

msg.url = "http://127.0.0.1:4173/api/ingest/reading";
msg.headers = {
  "Content-Type": "application/json",
  "x-ingest-token": "cambia-este-token"
};
msg.payload = {
  sensorId,
  topic: msg.topic,
  value,
  timestamp,
  source: "plcnext-node-red"
};

return msg;
```

### Configuración del nodo `http request`

- Method: `POST`
- URL: usar `msg.url`
- Return: `a parsed JSON object`

## Prueba rápida sin PLC

Podés probar el backend con PowerShell:

```powershell
Invoke-WebRequest `
  -Uri "http://localhost:4173/api/ingest/reading" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"sensorId":"water-temperature","value":22.1,"source":"plcnext-node-red"}'
```

## Comportamiento del dashboard

- Cuando entra una lectura real, el sistema sale de mock automáticamente.
- El botón principal pasa a `Volver a mock`.
- Los actuadores quedan en solo lectura mientras la fuente real está activa.
- Conviene que Node-RED publique todas las variables al arrancar o envíe un primer `batch`, así cada tarjeta del dashboard pasa rápido a valores reales.
