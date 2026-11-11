# J17 por Wi-Fi y control de bombas peristalticas

## Conexion

La ESP32-S3 publica sus sensores por Wi-Fi de 2.4 GHz hacia el servidor de la PC:

```text
ESP32 -> HTTP POST /api/ingest/batch -> Node -> dashboard/SSE
             <- ordenes pendientes <- botones de la web
```

El USB se usa una vez para cargar el firmware y despues es opcional para
diagnostico. Para funcionar sin la PC conectada por USB, la placa necesita
alimentacion adecuada, por ejemplo desde su cargador USB. Las bombas conservan
su fuente propia: no deben alimentarse desde las salidas de la ESP32.
La PC que aloja Node debe seguir encendida y en la misma red.

Configuracion privada, excluida de Git:

- `.env.wifi.local`: `DATA_MODE=esp32-wifi`, identidad del equipo,
  `INGEST_TOKEN` y `RELAY_CONTROL_TOKEN` diferentes y aleatorios.
- `firmware/tesis_huerta_j17_wifi/secrets.h`: Wi-Fi, URL de ingesta e
  `INGEST_TOKEN` identico al del servidor.

Ejemplos sin credenciales: `.env.wifi.example` y `secrets.h.example`.
Para iniciar el servidor sin el lector USB:

```powershell
npm run start:wifi
```

No iniciar `start:usb` al mismo tiempo. Si cambia la IP de la PC, actualizar
`WEB_INGEST_URL` y volver a cargar el firmware; se recomienda reservar su IP
en el router. La ESP32 obtiene su propia IP por DHCP. Si un firewall bloquea
la conexion, habilitar solamente TCP 4173 desde la subred local.

HTTP esta pensado para una LAN de confianza. No publicar este servidor ni
abrir sus puertos a Internet. Para acceso remoto usar VPN o un despliegue
autenticado con HTTPS; las claves no cifran el transporte HTTP.

## Bombas

| Bomba | GPIO | Nivel de encendido |
| --- | --- | --- |
| 1 | 39 | LOW |
| 2 | 40 | LOW |
| 3 | 47 | HIGH |
| 4 (firmware v3) | 41 | LOW |

Se conserva la polaridad del programa original. El cableado NO/NC de los
contactos debe corresponder al apagado seguro; la PC no puede comprobarlo.

La cuarta bomba se confirmo en GPIO41 y en el mismo modulo activo en LOW
que GPIO39/40. No usar GPIO42. El firmware de cuatro salidas esta en
`firmware/tesis_huerta_j17_wifi_v3/`; la version anterior de tres salidas
se conserva en `firmware/tesis_huerta_j17_wifi/`.
El servidor acepta v1/v2 con tres estados y v3 con exactamente cuatro.
No permite controlar una salida que el firmware no haya informado.
Apagar todas incluye solo las salidas compatibles con el equipo conectado.
La cantidad en el resumen y la tarjeta Bomba 04 se actualizan desde la telemetria.

Como los reles manejan bombas peristalticas, el firmware nuevo no permite
control por lux ni dosificacion automatica con pH/EC sin calibrar:

- Arranque apagado, sin restaurar encendidos anteriores.
- Pulsos manuales de 1 a 10 segundos, con 5 segundos seleccionados por defecto.
- Modo continuo manual, elegido expresamente: mantiene la bomba encendida
  hasta Apagar o Apagar todas. Cerrar el navegador no la apaga mientras el
  servidor siga comunicandose con la ESP32. Este modo requiere firmware v2.
- Una sola bomba funcionando a la vez, verificado en servidor y ESP32.
- Tarea local independiente que corta el pulso aunque HTTP o los sensores
  esten bloqueando el bucle principal. No depende del navegador ni del USB.
- Corte adicional ante 30 segundos sin respuesta valida del servidor.
- Botones de apagado individual y apagado de todas, tambien en modo continuo.
  Una orden por red no es una parada de emergencia fisica.

El volumen dosificado no se conoce: requiere medir y calibrar el caudal de
cada bomba. El estado mostrado es el de la salida informado por el firmware,
no una medicion de contactos, giro, caudal ni liquido realmente entregado.
Antes de usar continuo, verificar que el modelo de bomba y su fuente admitan
ese regimen de trabajo; supervisar el recipiente, el volumen y la temperatura.
El software no puede determinar el ciclo de trabajo permitido del motor.

El modo continuo no elimina el corte por 30 segundos sin servidor. Despues
de ese corte, restablecer Wi-Fi no vuelve a encender la bomba: hace falta
una orden nueva. Tampoco se guarda un encendido para restaurarlo al reiniciar.
El firmware v1 sigue admitido, pero la pagina deshabilita continuo hasta que
la propia ESP32 anuncie la capacidad `timed-continuous-pumps-v2`.
La version v3 conserva ambos modos y anuncia `four-timed-continuous-pumps-v3`.

## Estado y confirmacion

Los botones no cambian el estado visible a Encendida por su cuenta. El
servidor guarda una orden con ID, arranque del equipo y vencimiento de
15 segundos; la envia en la respuesta al siguiente POST de la ESP32.
La placa aplica cada ID una sola vez y luego informa el resultado.
Si el pulso finalizo antes de esa telemetria, informa `completed` y apagado.
Cada orden y cada reporte de v2 distinguen `runMode: pulse` y `continuous`.
Un `durationMs: 0` sin modo continuo explicito nunca es un encendido valido.
El vencimiento de 15 segundos es de entrega de la orden, no una duracion del
funcionamiento continuo ya confirmado.

Sin telemetria durante 15 segundos, la pagina muestra Sin confirmar,
no Apagada, y deshabilita los botones. No se reenvian ordenes vencidas al
reconectar. Los reinicios cancelan pendientes y no recuperan encendidos.
Un apagado invalida ordenes de encendido basadas en un estado anterior.

Desde localhost el operador puede controlar sin exponer una clave al
JavaScript. En otras pantallas se necesita la clave `RELAY_CONTROL_TOKEN`;
la sesion usa cookie HttpOnly/SameSite y dura ocho horas. Los cambios
requieren mismo origen y las ordenes de ingesta requieren token de equipo.

## Sensores y diagnostico pendiente

### Referencia de nivel resistivo

La entrada de nivel en GPIO3 se convierte en la PC con dos referencias
medidas: pistas secas y zona sensible sumergida. Se guardan localmente en
`data/water-level-calibration.json`, excluido de Git. Para trasladar esta
calibracion a otra PC hay que transferir ese archivo de forma privada y
mantener el mismo sensor, placa y firmware; no contiene claves.

La conversion es `100 * (RAW - seco) / (sumergido - seco)`.
Es una escala relativa de respuesta electrica, no una medicion lineal
de altura ni porcentaje de volumen del tanque. No utiliza los ultrasonicos
y no controla bombas automaticamente. Los valores se limitan a 0-100%;
se conserva el RAW original y se advierte si sale de las referencias
mas alla de la variacion observada durante la toma de muestras.
El redondeo no adelanta el 100%: una respuesta por debajo del maximo
de referencia se muestra como 99% como mucho.

El servidor rechaza referencias incompletas, demasiado cercanas o sin
separacion suficiente frente a su variacion. Solo aplica la conversion
a la fuente, identidad de placa y version de firmware registradas.
Una senal ausente, invalida o vencida no se convierte en cero ni mantiene
el ultimo porcentaje. El historial porcentual empieza al completar
las referencias y conserva los intervalos sin lectura.
La interfaz muestra `Nivel resistivo` en `Niveles y depositos`; las dos
referencias tambien estan en `Equipo > Detalles del equipo`.

Se conserva todo el mapa J17: pH 1, TDS 2, nivel RAW 3; ultrasonicos
4/5, 6/7, 12/13, 14/15, 18/21; I2C 8/9; DHT11 10; DS18B20 11;
MH-Z19 RX16/TX17. No se modifica su calibracion heredada.

El pH sigue pendiente de reparar la pista levantada y calibrar la sonda.
Los errores no se sustituyen por lecturas simuladas. TDS conserva su aviso
de calibracion y EC es una estimacion a partir del factor 0.5 original.
El nivel porcentual permanece sin calibrar, separado de distancias y RAW.

## Pruebas

`tests/relay-control.test.js` valida interbloqueos, vencimientos, reinicios,
sesiones, confirmacion, apagado prioritario y mapa de pines.
`tests/wifi-control.test.js` levanta un servidor aislado con un dispositivo
simulado; nunca envia ordenes a la placa fisica ni a las bombas.
La compilacion y la recepcion de telemetria no verifican por si mismas el
funcionamiento mecanico de un rele. Las pruebas de encendido requieren
supervision, recipientes preparados y condiciones seguras.
