# Referencia del firmware J17 del usuario

`TESIS_HUERTA_J17.ino` es una copia sin modificaciones del archivo entregado
el 2026-11-08. No se ha compilado ni cargado en la placa desde este proyecto.
El archivo de Descargas tambien se conserva sin cambios.

Pines analogicos declarados: pH GPIO1, TDS GPIO2, nivel resistivo GPIO3.

El perfil `tesis-huerta-j17` del puente USB usa el factor 0.5 que aparece en
`leerTDS()`. A partir del TDS impreso calcula `EC_estimada_mS_cm = TDS_ppm / 500`.
El TDS llega redondeado a ppm enteros, por lo que esta reconstruccion pierde
precision y no certifica calibracion, compensacion de temperatura correcta,
tipo de sonda, alimentacion ni conexion electrica.

La relacion EC/TDS esta documentada en la libreria oficial de DFRobot:
https://github.com/DFRobot/GravityTDS/blob/master/GravityTDS.cpp
El sketch del usuario compensa el voltaje antes del polinomio; la libreria
actual compensa EC despues. El puente conserva el resultado del firmware,
no sustituye ni valida esa compensacion.

La recta de pH del sketch da 27.9573 a cero voltios de entrada. Una lectura
impresa de 27.96 sugiere GPIO1 cerca de 0 V segun esa recta; es una inferencia,
no una lectura ADC directa. Se rechaza como pH valido. Deben verificarse
alimentacion, GND comun, salida analogica, divisor y calibracion con patrones.
No se corrigen constantes usando una muestra de pH desconocido.

La referencia original no se modifica. La copia separada de diagnostico agrega
ADC/milivoltios y EC sin redondear, sin cambiar pines ni control de reles.
El usuario autorizo su carga y el reinicio el 2026-11-08. La web solo lee el USB.
