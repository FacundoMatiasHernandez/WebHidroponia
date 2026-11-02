# HydroVision en otra notebook

## 1. Obtener el proyecto

Instalar Git y Node.js 24 (con npm). No se necesita Arduino IDE para ejecutar
la web; solo para compilar o volver a cargar el firmware de las placas.
Estos comandos se ejecutan en PowerShell, en una carpeta elegida para el proyecto:

```powershell
git clone https://github.com/FacundoMatiasHernandez/WebHidroponia.git
cd WebHidroponia
node --version
npm --version
```

Si el repositorio ya existe en la notebook, abrir su carpeta y revisar primero
`git status`. Con el arbol limpio, actualizar mediante `git pull --ff-only`.
No descartar cambios locales para actualizar. Si Git solicita autenticacion,
usar la cuenta con acceso al repositorio.

## 2. Iniciar la web con la camara

Conectar la notebook a una red desde la que se pueda alcanzar la ESP32-CAM.
La camara se comunica por WiFi; el USB sirve para alimentacion, programacion y
diagnostico, no para transmitir el video al navegador.

```powershell
Copy-Item .env.camera.example .env.camera.local
notepad .env.camera.local
npm run start:camera
```

Copiar la plantilla solo si todavia no hay configuracion local, para no
sobrescribir ajustes propios. Reemplazar la IP de ejemplo por la direccion
actual de la camara. Abrir `http://localhost:4173/` y mantener la terminal abierta;
Ctrl+C detiene el servidor. No ejecutar dos servidores en el mismo puerto.

La plantilla contiene estos ajustes, sin claves de WiFi:

```dotenv
CAMERA_MJPEG_URL=http://192.168.15.12:81/stream
CAMERA_LABEL=ESP32-CAM OV3660
CAMERA_STILL_QUALITY=12
CAMERA_ANALYSIS_JPEG_QUALITY=12
```

`192.168.15.12` es la direccion usada en la instalacion anterior, no una IP
garantizada para todas las redes. La compresion 12 conserva fotos QXGA de
2048x1536 y evita el desbordamiento `FB-OVF` observado con calidad 8 en esa
escena. El numero mayor implica mas compresion; no es autofocus. El perfil
de video permanece en UXGA y calidad 10. Otros montajes pueden necesitar ajustes.

Para ejecutar solo la web sin cargar la configuracion de camara:

```powershell
npm start
```

No hay dependencias npm de produccion: `npm install` no es un requisito para
arrancar. `start:camera` utiliza `node --env-file`, disponible en la version
de Node indicada. La configuracion se lee al iniciar: reiniciar el proceso si
se modifica el archivo. Las variables ya definidas en la terminal tienen
prioridad sobre el archivo; revisar variables `CAMERA_*` si el resultado difiere.

## 3. Redirigir las lecturas de la ESP32-S3

El firmware de sensores publica en `http://<WEB_HOST>:4173/api/ingest/batch`.
Clonar el repositorio no cambia el destino que ya esta grabado en la placa.

1. Obtener la IPv4 de la notebook en la red del cultivo mediante `ipconfig`.
2. Crear `firmware/esp32_web_direct/secrets.h` desde su archivo `.example`,
   o trasladar la configuracion privada de la PC anterior.
3. Completar WiFi y `WEB_HOST` con la IP de la notebook, sin `http://` ni puerto.
4. Compilar/cargar el firmware en la ESP32-S3 con su perfil de placa y puerto USB.
5. Verificar por serial (115200 baud) respuestas HTTP correctas y fechas recientes
   en las lecturas del dashboard.

La notebook y las placas necesitan conectividad entre si. Si Windows bloquea
la ingesta, permitir Node/puerto 4173 en el perfil de red privada correspondiente;
no desactivar el firewall ni abrir puertos del router a Internet. Evitar redes
de invitados con aislamiento entre dispositivos.

Una reserva DHCP para la notebook ayuda a mantener estable `WEB_HOST`. No asignar
simultaneamente la misma IP a la PC anterior y a la notebook. Si se usa otro
puerto de backend, alinear tambien `WEB_PORT` del firmware.

La ESP32-CAM no necesita reflashearse solo por cambiar de PC: Node se conecta
a la IP de la camara. Si cambia el WiFi, sus credenciales si deben actualizarse
en `firmware/esp32_cam_webserver/secrets.h` y en el firmware cargado.

## 4. Verificar el arranque

Desde otra terminal:

```powershell
Invoke-RestMethod http://localhost:4173/api/health
Invoke-RestMethod http://localhost:4173/api/bootstrap
```

`cameraMode: mjpeg` confirma configuracion, no conectividad fisica. Comprobar
tambien una foto con "Actualizar imagen HD" y el video en la pagina. La camara
ofrece `/status` en su puerto HTTP habitual, y `/stream` en el 81.

Revisar `source` y `timestamp` de cada sensor. Que el modo global diga
`esp32-direct` no demuestra que todos los indicadores sean reales: hay canales
sin adquisicion implementada que pueden conservar valores simulados anteriores.

## 5. Trasladar historial y fotos de forma privada (opcional)

Git contiene codigo, pruebas y documentos. Se excluyen deliberadamente:

- `data/runtime-state.json`: estado, historial y resultados guardados.
- `data/plant-captures/`: fotos originales, incluidas las usadas por pruebas reales.
- `data/vision-validation/`: resultados y capturas auxiliares de diagnostico.
- `firmware/**/secrets.h` y `.env.camera.local`: configuracion privada/local.
- Logs, compilaciones y el respaldo binario previo de la prueba del servo.

Para conservar los analisis, detener ambos servidores y copiar por un medio
privado `data/runtime-state.json` junto con toda la carpeta `data/plant-captures/`,
manteniendo las rutas relativas. Si ya hay datos en la notebook, respaldarlos
antes: no hay una fusion automatica de historiales. Luego reiniciar la web.

No copiar solo el JSON: las referencias a fotos quedarian sin sus archivos.
Sin estos datos, un clon nuevo arranca con estado de demostracion y sin historial
visual. No ejecutar `npm run reset-data` para trasladar datos: elimina el estado.

Mantener credenciales fuera de Git incluso si el repositorio es privado.
No copiar `node_modules` entre sistemas; las dependencias opcionales se instalan
en la maquina de destino.

## 6. Ejecutar pruebas

```powershell
npm test
```

La suite actual define 58 casos. En un clon sin fotos y sin `sharp`, 45 pueden
ejecutarse y 13 pruebas reales se omiten explicitamente. Eso no es un fallo,
pero tampoco valida esas 13 pruebas.

Para las pruebas reales y utilidades de inspeccion, trasladar el corpus privado
e instalar la dependencia opcional sin cambiar el manifiesto del proyecto:

```powershell
npm install --no-save --package-lock=false sharp
npm test
```

Las utilidades de captura con iluminacion modifican temporalmente la camara;
no forman parte del arranque normal y no deben ejecutarse sin preparar el montaje.

## 7. Material complementario

Los dos documentos estan en `output/pdf/`. Son la edicion de septiembre de 2026;
la plantilla actual incluye el ajuste posterior de compresion de octubre.

`firmware/uno_mg995_test/` y `output/servo_mg995_test/run_test.ps1` corresponden
a una prueba independiente del servo. No son necesarios para levantar HydroVision.
El sketch mueve el servo automaticamente tras arrancar/reiniciar: leer su README
antes de alimentarlo o abrir su puerto. No se ejecuta desde `npm start`.

La web sigue siendo un prototipo para una red de confianza. No publicarla en
Internet tal como esta: requiere restringir archivos servidos, autenticacion,
validacion de entradas y proteccion del transporte.
