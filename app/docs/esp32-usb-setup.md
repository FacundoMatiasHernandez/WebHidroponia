# ESP32-S3 por USB: lecturas reales

Iniciar desde la raiz del repositorio:

```powershell
npm run start:usb
```

El lanzador inicia la web y un lector USB persistente. No requiere Wi-Fi en
la placa ni modifica su firmware. Mantener la PC encendida y el cable USB
conectado. No abrir el monitor serie de Arduino al mismo tiempo: el puerto
serie solo puede ser usado por un lector. La configuracion local actual es
COM13, 115200 baud. La placa imprime un bloque aproximadamente cada 3 segundos;
los sensores internos pueden actualizarse cada 1-10 segundos segun su firmware.

`.env.usb.local` (ignorado por Git) configura `ESP32_SERIAL_PORT`,
`ESP32_SERIAL_BAUD` y `ESP32_FIRMWARE_PROFILE`. El ejemplo deja el perfil en
`unknown`: nunca se transforma TDS en EC para un firmware no verificado.
El perfil local `tesis-huerta-j17` se habilito tras revisar el `.ino` del usuario.
No sirve automaticamente para otro programa que use otro factor.

La ruta es: ESP32 -> consola USB -> parser de bloques completos -> POST local
`/api/ingest/batch` -> dashboard/SSE. No se escriben comandos en el puerto ni
se controlan reles desde la web. El estado de rele es el que informa la placa.

El modo real elimina datos mock de la instantanea y de su historico visible.
No hay reemplazo simulado al desconectar. Tras 15 segundos sin datos, los
valores pasan a `-- / Desactualizado`. Los errores no se convierten en cero.
El historico mantiene huecos en lugar de dibujar lecturas falsas.

Las cinco distancias se muestran en cm. El nivel resistivo se muestra como
RAW ADC. El porcentaje de nivel queda sin calibrar hasta conocer las alturas
de tanque vacio y lleno. La lectura TDS se conserva en ppm; en el perfil J17
EC se muestra como estimacion derivada (TDS/500), no como medicion calibrada.
Un TDS impreso como 0 no permite confirmar agua pura ni una sonda funcional.
El pH fuera de 0-14 se rechaza y conserva el valor informado para diagnostico.

La copia de referencia y el detalle de pH/EC estan en
`firmware/tesis_huerta_j17_original/`. El usuario autorizo cargar la copia
separada `firmware/tesis_huerta_j17_diagnostico/`, que agrega ADC/milivoltios y
EC sin redondear. Se guardaron los sectores afectados antes de escribir y
se verifico la carga por hash. Los GPIO y la logica de reles son los originales.
`meta.firmwareBuild` identifica el diagnostico instalado; las lecturas incluyen
`diagnostic: {pin, raw, millivolts}` sin presentar esos datos como pH calibrado.
