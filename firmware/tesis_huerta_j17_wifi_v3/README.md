# J17 Wi-Fi V3: Cuatro Bombas

Version de cuatro salidas; conserva sin cambios la adquisicion y los pines
de todos los sensores de la version Wi-Fi v2.

| Bomba | GPIO | Encendido | Apagado |
| --- | --- | --- | --- |
| 01 | 39 | LOW | HIGH |
| 02 | 40 | LOW | HIGH |
| 03 | 47 | HIGH | LOW |
| 04 | 41 | LOW | HIGH |

GPIO41 y su polaridad se confirmaron para esta instalacion. No es GPIO42.
Las bombas van a los contactos de los reles y a su fuente correspondiente,
no directamente a un GPIO.

Antes de cargar, dejar las cargas en condiciones seguras: durante el
arranque o la carga no se puede garantizar el estado fisico de un modulo.
El programa precarga el nivel de apagado antes de habilitar cada salida.
No restaura encendidos ni genera una dosificacion automatica.

Las cuatro salidas tienen pulsos de 1-10 s o continuo elegido expresamente.
El enclavamiento permite solo una bomba a la vez. La tarea local independiente
corta los pulsos vencidos y apaga cualquier bomba activa despues de 30 s
sin respuesta valida del servidor. Cerrar la pagina no apaga el continuo.

Copiar secrets.h.example a secrets.h y configurar localmente las mismas
credenciales de la instalacion. secrets.h y las imagenes compiladas no se
deben publicar: contienen credenciales. Para esta placa se conserva el FQBN:

```text
esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc,UploadMode=default,FlashSize=16M
```

El perfil reproducible esp32s3 esta en sketch.yaml, sin fijar un puerto USB.
Versiones usadas: ESP32 core 3.3.8; DHT sensor library 1.4.7,
Adafruit Unified Sensor 1.1.15, MH-Z19 1.5.4, OneWire 2.3.8
y DallasTemperature 4.0.6. Instalar estas bibliotecas si se compila desde
Arduino IDE; WiFi, HTTPClient, cJSON y FreeRTOS provienen del core.

Actualizar primero el servidor: debe reconocer firmwareBuild
tesis-huerta-j17-wifi-v3 y capability four-timed-continuous-pumps-v3.
El programa anterior se conserva en ../tesis_huerta_j17_wifi/.
No volver a cargar v2 con la cuarta carga conectada sin verificar antes
su apagado fisico: v2 no administra GPIO41.

La referencia de nivel resistivo sigue en la PC; al migrar de v2 a v3
se debe registrar la nueva version sin cambiar los puntos medidos, dado
que GPIO3 y su adquisicion no cambian. Esto no valida el nivel como altura
ni volumen: se conserva tambien la comprobacion intermedia anterior.
