# Prueba independiente de servo MG995 con Arduino Uno

Este sketch y `output/servo_mg995_test/run_test.ps1` se conservan como parte de
las pruebas del proyecto. No se usan para iniciar la web ni la ESP32-CAM.

**Atencion:** el firmware inicia un movimiento nominal de 0 a 180 grados unos
dos segundos despues de encender o reiniciar la placa. Abrir el puerto serial
puede reiniciar un Arduino Uno. No conectar ni ejecutar sobre un mecanismo sin
verificar alimentacion, limites mecanicos y espacio libre. Los angulos del codigo
son nominales y no equivalen a una calibracion mecanica.

El codigo utiliza `Servo.h`, senal en D2 y comunicacion serial a 115200 baud.
El puerto predeterminado del script es COM11, pero debe identificarse de nuevo
en cada equipo y pasarse mediante `-Port` cuando sea diferente.

Comandos del firmware: `T` lento, `F` rapido, `W` rango mas amplio, `A` ensayo
0..120..0, `E` ensayo 0..180, `X` detener y cancelar inicio automatico, `S` estado.
El script requiere la confirmacion de identidad del firmware antes de enviar
un comando de prueba. Su ejecucion puede producir movimiento fisico.

Los logs, binarios compilados y el respaldo `uno_before_test_*.hex` permanecen
locales y excluidos de Git. No se modifican ni eliminan al guardar este codigo.
