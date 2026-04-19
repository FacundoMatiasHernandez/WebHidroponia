# Raspberry Pi 3 + webcam USB + HydroVision

## Objetivo

Conectar una Raspberry Pi 3 con una webcam Logitech por USB, procesar la imagen en la Raspberry y mostrar el video en tiempo real dentro del dashboard HydroVision.

La ruta recomendada para empezar es esta:

`Raspberry Pi 3 -> script Python/OpenCV -> MJPEG HTTP -> HydroVision`

La elegi porque:

- usa solo HTTP en la red local
- no necesita reproductores extras en el navegador
- te deja un punto claro para agregar procesamiento de imagen
- es una carga razonable para una Raspberry Pi 3 si arrancas en `640x360` y `10 fps`

## 1. Preparar la Raspberry

En la Raspberry:

```bash
sudo apt update
sudo apt install -y fswebcam v4l-utils python3-opencv python3-flask
sudo usermod -a -G video $USER
```

Despues cerra sesion y volve a entrar, o reinicia la Raspberry, para que el grupo `video` tome efecto.

## 2. Verificar que la webcam aparezca

```bash
v4l2-ctl --list-devices
fswebcam test.jpg
```

Si esta bien, deberias ver `/dev/video0` y tambien deberia aparecer un archivo `test.jpg`.

## 3. Copiar el script de stream

En este proyecto te deje un ejemplo listo en:

`examples/raspberry-camera-stream.py`

Copialo a la Raspberry o abrilo desde aca y pegalo alla.

## 4. Ejecutar el stream en la Raspberry

Ejemplo recomendado para empezar:

```bash
python3 raspberry-camera-stream.py --device /dev/video0 --host 0.0.0.0 --port 8081 --width 640 --height 360 --fps 10
```

Endpoints del script:

- `http://<ip-de-tu-raspberry>:8081/health`
- `http://<ip-de-tu-raspberry>:8081/snapshot.jpg`
- `http://<ip-de-tu-raspberry>:8081/stream.mjpg`

## 5. Probar el video desde tu PC

Antes de tocar HydroVision, proba esto en el navegador de tu PC:

`http://<ip-de-tu-raspberry>:8081/stream.mjpg`

Si ves video, la Raspberry ya esta haciendo su parte.

## 6. Conectar HydroVision al stream

En la PC donde corre HydroVision, levantalo asi en PowerShell:

```powershell
$env:CAMERA_MODE = "mjpeg"
$env:CAMERA_MJPEG_URL = "http://raspberrypi.local:8081/stream.mjpg"
$env:CAMERA_LABEL = "Raspberry Pi 3 / Logitech USB"
$env:PORT = "4174"
npm start
```

Si preferis usar la IP en vez de `raspberrypi.local`, tambien sirve:

```powershell
$env:CAMERA_MJPEG_URL = "http://192.168.1.50:8081/stream.mjpg"
```

Cuando la web reciba esa configuracion:

- deja de mostrar el canvas mock
- muestra el MJPEG real
- mantiene el resto del dashboard igual

## 7. Donde meter tu procesamiento de imagen

En el script, el lugar para agregar logica real es:

```python
def process_frame(frame, label):
```

Ahi ya te deje un ejemplo liviano:

- etiqueta del equipo
- timestamp
- marco y guias visuales

Mas adelante ahi mismo podes poner:

- deteccion de plantas
- deteccion de color de hojas
- conteo de bandejas
- OCR
- zonas de interes

## 8. Si despues queres menos latencia

Para una segunda etapa, el dashboard tambien acepta un visor embebido externo:

- `CAMERA_MODE=embed`
- `CAMERA_EMBED_URL=http://<host>/alguna-pagina.html`

Eso te sirve si mas adelante queres pasar a WebRTC con un servidor de streaming.

## 9. Problemas comunes

### No aparece `/dev/video0`

- proba desconectar y volver a conectar la webcam
- corre `v4l2-ctl --list-devices`
- revisa que la webcam reciba alimentacion suficiente

### El stream abre en la Raspberry pero no en la PC

- revisa que ambas esten en la misma red
- proba con la IP en vez de `raspberrypi.local`
- revisa firewall o puertos

### El video va lento

Baja primero estos valores:

- `--width 640`
- `--height 360`
- `--fps 8`
- `--jpeg-quality 65`

## Fuentes

- Raspberry Pi documentation, "Use a USB webcam": https://www.raspberrypi.com/documentation/computers/camera_software.html
- OpenCV `VideoCapture`: https://docs.opencv.org/4.x/d8/dfe/classcv_1_1VideoCapture.html
- Debian package `python3-opencv`: https://packages.debian.org/bookworm/python3-opencv
- Debian package `python3-flask`: https://packages.debian.org/en/bookworm/python3-flask
- Debian package `v4l-utils`: https://packages.debian.org/bookworm/v4l-utils

## Nota

La recomendacion de usar MJPEG como primer paso es una inferencia practica mia a partir del hardware que tenes, del estado actual del dashboard y de la necesidad de avanzar rapido sin sumar complejidad de WebRTC todavia.
