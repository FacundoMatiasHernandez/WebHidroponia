# Diagnostico J17

Copia del programa original con cambios limitados a diagnostico:

- Conserva los mismos GPIO, coeficientes de pH/TDS y control de reles.
- Registra el promedio ADC que ya usa cada calculo.
- Toma una conversion adicional con analogReadMilliVolts() por sensor.
- Imprime la estimacion EC desde TDS sin su redondeo serial a ppm enteros.
- Identifica el firmware como `tesis-huerta-j17-diagnostico-v1`.

La lectura en milivoltios usa la calibracion electrica disponible en el ADC;
no calibra la sonda quimica. El pH sigue usando la formula original, para
diagnosticar el problema sin cambiar su resultado artificialmente.

La carga reinicia la placa. El usuario autorizo este reinicio y la posible
transicion momentanea de reles. No usar en un sistema con cargas que no
toleren el reinicio. El programa original esta en la carpeta de referencia.

## Carga verificada: 2026-11-08

Compilado para ESP32-S3, flash 16 MB, USB Serial/JTAG y CDC al inicio, con
Arduino-ESP32 3.3.8 y las bibliotecas fijadas en sketch.yaml. Programa de
367984 bytes, verificado por hash despues de escribir. No se uso la imagen
merged de 16 MB ni un borrado completo.

El respaldo completo fallo por interrupcion USB. Se guardo y verifico por
digest el primer MB, suficiente para todos los sectores modificados:
bootloader 0x0-0x4fff, particiones 0x8000-0x8fff, boot_app0 0xe000-0xffff y
programa 0x10000-0x69fff. No hubo escrituras fuera de esa region respaldada.
Respaldo privado: tmp/esp32-j17-backup/first-1mb-before-j17-diagnostic-20261108.bin.
SHA-256: E4608BE9A438628D911CD0BD8852BD365C5F2DF7F49F76CD8CABDF9B97B38480.
No es una copia de los 16 MB completos; conservar para revertir esta carga.

Lecturas verificadas tras el reinicio: GPIO1 pH ADC 0 y 0 mV; GPIO2 TDS
aproximadamente ADC 939, 803 mV, 295 ppm y EC estimada 0.590 mS/cm.
El pH 27.96 se rechaza: la calibracion no puede resolver una entrada sin senal.
Se requiere revisar el circuito de pH y posteriormente calibrarlo con patrones.

## Referencia antigua PH.pdf

El PDF entregado despues usa GPIO4 para la prueba aislada de pH, con el mismo
divisor 10k/20k y la misma calibracion casera. No es el mapa del sistema J17:
en J17 pH es GPIO1, TDS es GPIO2 y GPIO4 es US1_TRIG, configurado como salida.
No cambiar PIN_PH a 4 ni conectar ambas senales al mismo GPIO. Verificar el
cableado fisico antes de atribuir la lectura ADC cero a la calibracion.
El dibujo de alimentacion del PDF tiene un cruce ambiguo junto a V+; V+ y GND
son redes separadas. La foto del montaje real es necesaria para confirmarlo.
