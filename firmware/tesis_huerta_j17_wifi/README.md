# ESP32-S3 J17 por Wi-Fi

Firmware de sensores J17 con telemetria HTTP y bombas manuales por pulso o continuas.
`sensores_j17.h` conserva los lectores, diagnosticos y pines de la copia J17;
se elimina la actuacion automatica por luz porque los tres reles controlan
bombas peristalticas. El programa original y su diagnostico no se modifican.

Version de tres bombas conservada: `tesis-huerta-j17-wifi-v2`, capacidad `timed-continuous-pumps-v2`.
La instalacion actual de cuatro bombas usa `../tesis_huerta_j17_wifi_v3/`;
no cargar esta version v2 para controlar GPIO41.
Los pulsos mantienen el maximo de 10 segundos; continuo solo se activa con
`runMode=continuous` y `durationMs=0`. Ambos modos conservan el interbloqueo,
el arranque apagado y el corte local por 30 segundos sin servidor. Una
reconexion no restaura un encendido. No se permite control por lux.

Configuracion, protecciones, estados y puesta en marcha:
`../../app/docs/esp32-wifi-control.md`.

Copiar `secrets.h.example` a `secrets.h` y configurar localmente antes de
compilar. El archivo privado no debe subirse a Git ni publicarse en la web.

FQBN: `esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc,UploadMode=default,FlashSize=16M`.
ESP32 core 3.3.8. Bibliotecas J17: DHT sensor library, Adafruit Unified Sensor,
MH-Z19, OneWire y DallasTemperature. Wi-Fi, HTTPClient, cJSON y FreeRTOS
provienen del core de ESP32; no requieren bibliotecas adicionales.

Antes de cargar, poner las cargas en condiciones seguras: la placa se reinicia.
Nunca puentear el divisor de pH ni cambiarlo a GPIO4, que es US1_TRIG.

## Carga local verificada: 2026-11-09

Compilado con core 3.3.8: 1004541 bytes de programa, 47764 bytes de RAM global.
Se respaldo y verifico por digest el primer bloque de 2 MB antes de cargar;
no es un respaldo completo de los 16 MB. Archivo privado:
`tmp/esp32-j17-backup/first-2mb-before-j17-wifi-20261109.bin` en la raiz del repo.
SHA256: `0724F6AEF630B76E0CBFDC83AABDB2B488D354EBD38282443BBC99FE4FE02CBD`.

Se escribieron solo bootloader, particiones, boot_app0 y aplicacion, todos
dentro de la region respaldada; esptool verifico los hashes. Sin erase-all.
Telemetria HTTP recibida desde 192.168.120.68, con MAC correspondiente a
la placa identificada en COM13. El lector USB quedo detenido.
No se enviaron encendidos desde las pruebas automatizadas. Las pruebas de
servidor usan puertos efimeros y un dispositivo simulado, separados de la placa.

## Actualizacion v2 verificada: 2026-11-10

Compilada con core 3.3.8: 1004837 bytes de programa y 47764 bytes de RAM global.
Respaldo privado previo de los primeros 2 MB, verificado contra la flash por digest:
`tmp/esp32-j17-backup/first-2mb-before-continuous-20261110.bin`.
SHA256: `D3A3827908112AB9D31BB6CE4919B63566B8C58E6DA1E79A0F73C538B3EC3C1D`.
No es una copia completa de los 16 MB de la placa.

Se actualizo solo la aplicacion en 0x10000, con verificacion de hash, sin
reescribir bootloader, particiones ni boot_app0 y sin erase-all. La placa
volvio a publicar por Wi-Fi desde 192.168.120.68 con capacidad continua v2,
las tres salidas apagadas y ninguna orden de encendido enviada en las pruebas.
