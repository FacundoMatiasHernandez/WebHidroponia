# HydroVision: instalación y transferencia

Guía para un compañero y su asistente de programación. Actualizada el 11 de noviembre de 2026.

Repositorio: https://github.com/FacundoMatiasHernandez/WebHidroponia

## 1. Elegir qué se necesita

El proyecto tiene cinco vistas: Resumen, Bombas, Cámara, Tendencias y Equipo.
Funciona con un servidor Node.js, una ESP32-S3 de sensores y una ESP32-CAM OV3660.
No utiliza el PLC ni la Raspberry Pi.

| Objetivo | Qué hacer |
| --- | --- |
| Ver la instalación que ya está funcionando | Abrir la dirección de la PC del servidor desde un navegador de la misma red. No hace falta clonar ni reprogramar placas. |
| Obtener esta misma interfaz en otra PC | Clonar o actualizar el repositorio e iniciar Node. Sin placas no habrá mediciones ni video: no se generan datos de demostración. |
| Mudar el servidor y seguir usando las placas | Además del código, configurar la red y trasladar los archivos privados necesarios. El destino HTTP grabado en la ESP32 debe corresponder a la nueva PC. |

**Regla de seguridad:** instalar la web no autoriza a encender bombas, cargar firmware,
reiniciar placas, cambiar polaridades o modificar conexiones. Antes de cualquiera de
esas acciones, el responsable debe confirmar el cableado y que las cargas están seguras.

### Requisitos para ejecutar la web

- Windows con PowerShell en los ejemplos. También puede ejecutarse con Node en otros sistemas.
- Git y Node.js 24. El entorno usado para verificar esta entrega es Node 24.22.1.
- Acceso al repositorio; si GitHub lo solicita, usar una cuenta autorizada.
- No se necesita Arduino IDE, una API de OpenAI ni una API key para ejecutar la web.
- No hay dependencias de producción: no hace falta ejecutar npm install.

Los archivos y herramientas de un chat no aparecen automáticamente en otro.
El asistente de destino debe trabajar sobre su propio clon. Si no tiene acceso
a terminal y archivos, debe guiar a la persona, sin afirmar que ejecutó pasos.

<!-- pagebreak -->

## 2. Descargar y abrir la página

### Clon nuevo

Abrir PowerShell en la carpeta donde se quiera guardar el proyecto:

```powershell
git clone https://github.com/FacundoMatiasHernandez/WebHidroponia.git
Set-Location WebHidroponia
node --version
git rev-parse --short HEAD
node --test tests/*.test.js
node server.js
```

Abrir http://localhost:4173/ y mantener el proceso Node encendido.
Ctrl+C lo detiene. No iniciar otro servidor en el mismo puerto.

### Si el proyecto ya estaba descargado

Dentro de su carpeta:

```powershell
git status --short
git branch --show-current
git pull --ff-only
git rev-parse --short HEAD
```

Ejecutar pull solo con el árbol limpio y la rama correcta. Si hay cambios propios,
divergencia de ramas o un error de autenticación, detenerse y explicarlo.
No usar reset --hard, clean, checkout para descartar archivos ni push --force.

### Resultado esperado sin hardware

Se debe ver el diseño completo con sus cinco vistas. Los valores sin señal aparecen
como no disponibles; las cuatro bombas tienen estado sin confirmar y controles
deshabilitados. La cámara no mostrará una imagen ficticia. Esto es correcto:
clonar el código no crea sensores ni copia su conexión de red.

Los equivalentes con npm son npm test y npm start. Si el entorno del asistente
dispone de Node pero no reconoce npm, los comandos directos anteriores funcionan.
Revisar el README y esta guía, no seguir las instrucciones de documentos antiguos
que describan un arranque con datos mock o el firmware esp32_web_direct.

<!-- pagebreak -->

## 3. Ver la instalación actual o trasladarla

### Solo ver y operar desde otra pantalla

Pedir al responsable la IPv4 de la PC que ya ejecuta HydroVision. En la misma red,
abrir http://IP_PC_SERVIDOR:4173/ desde el navegador de la otra PC o tablet.
No usar localhost allí: localhost siempre señala al dispositivo desde el que se abre.

La PC del servidor y las placas deben seguir alimentadas y conectadas.
Para manejar bombas desde otra pantalla se necesita la clave de control privada;
solo el acceso local del servidor se habilita sin escribirla en el navegador.
No compartir esa clave dentro del prompt público.

### Mudar el servidor a otra PC

Clonar el código no cambia la dirección grabada en la ESP32.
Coordinar una sola PC como servidor de la instalación y no duplicar su IP.
No detener el servidor viejo con bombas funcionando o sin estado confirmado.

| Archivo local | Para qué sirve y cómo trasladarlo |
| --- | --- |
| .env.wifi.local | Identidad y claves HTTP. Transferencia privada si se conserva la misma instalación. |
| .env.camera.local | IP y perfil de la cámara. Revisar la IP en la nueva red. |
| firmware/tesis_huerta_j17_wifi_v3/secrets.h | Wi-Fi, URL de destino y token de la placa. No se publica. |
| data/water-level-calibration.json | Referencias eléctricas de este sensor y placa. No son universales ni equivalen a litros. |
| data/runtime-state.json | Historial local opcional. No es necesario para que aparezca la interfaz. |
| data/plant-captures/ | Fotos referenciadas por el historial, si se desea conservarlo. |
| data/simulator-state.json | Estado opcional del laboratorio de tablet, separado de la operación. |

Estos archivos se excluyen de Git deliberadamente. No crear un commit ni un ZIP
público con ellos. Transferirlos por un canal privado autorizado y respaldar lo que
ya exista en destino. No hay fusión automática de historiales.
Si se trasladan análisis, copiar tanto el JSON como las fotos a sus mismas rutas.

Para una instalación diferente, usar credenciales nuevas y medir sus propias
referencias. No reutilizar la calibración de otro montaje como si fuera válida.

<!-- pagebreak -->

## 4. Conectar las mediciones reales

La ESP32-S3 publica por HTTP y el servidor devuelve las órdenes pendientes:

```text
ESP32-S3 -> POST /api/ingest/batch -> Node -> navegador
ESP32-S3 <- respuesta con órdenes <- Node <- controles web
```

### Preparar la configuración local

Solo crear las plantillas si el archivo de destino no existe:

```powershell
if (!(Test-Path .env.wifi.local)) {
  Copy-Item .env.wifi.example .env.wifi.local
}
if (!(Test-Path .env.camera.local)) {
  Copy-Item .env.camera.example .env.camera.local
}
```

En .env.wifi.local: DATA_MODE debe ser esp32-wifi; ESP32_DEVICE_ID debe coincidir
con la placa. INGEST_TOKEN y RELAY_CONTROL_TOKEN deben ser dos claves diferentes,
privadas y aleatorias, de al menos 32 caracteres.
No dejar los valores REEMPLAZAR de la plantilla ni usar ejemplos como claves reales.
El asistente no debe imprimir ni publicar las claves.

Iniciar desde la raíz del proyecto:

```powershell
node --env-file-if-exists=.env.camera.local --env-file=.env.wifi.local server.js
```

Equivalente con npm: npm run start:wifi. Para cambiar archivos .env hay que
reiniciar Node de forma coordinada. Variables ya definidas en la terminal tienen
prioridad sobre los archivos: revisarlas si la configuración no coincide.

### Cambiar de PC receptora

Obtener su IPv4 con ipconfig. En secrets.h del firmware v3, WEB_INGEST_URL debe
ser http://IP_NUEVA_PC:4173/api/ingest/batch, no localhost.
INGEST_TOKEN debe ser idéntico al del servidor y ESP32_DEVICE_ID debe coincidir.
No usar WEB_HOST: ese parámetro corresponde a otro firmware, no al J17 Wi-Fi actual.

Cargar firmware solo si el destino o las credenciales requieren cambiarlo y
después de la confirmación de seguridad. El perfil probado es:

```text
esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc,UploadMode=default,FlashSize=16M
```

Para compilar, usar ESP32 core 3.3.8 y las cinco bibliotecas con sus versiones
indicadas en firmware/tesis_huerta_j17_wifi_v3/sketch.yaml.
Solo son necesarias para programar la placa, no para ejecutar la web.

COM13 fue el puerto de esta PC, no un valor universal. El USB permite programar;
las lecturas y órdenes viajan por Wi-Fi. Sin USB a la PC, la placa necesita
alimentación adecuada y las bombas mantienen su fuente independiente.

<!-- pagebreak -->

## 5. Bombas, sensores y cámara

El firmware actual es tesis-huerta-j17-wifi-v3, en firmware/tesis_huerta_j17_wifi_v3/.
La versión anterior se conserva, pero no controla la cuarta salida.

| Bomba | GPIO | Encender | Apagar |
| --- | --- | --- | --- |
| 01 | 39 | LOW | HIGH |
| 02 | 40 | LOW | HIGH |
| 03 | 47 | HIGH | LOW |
| 04 | 41 | LOW | HIGH |

La cuarta es GPIO41, no GPIO42. Confirmar las polaridades del montaje antes de
cargar: la PC solo conoce la salida reportada, no el giro ni el caudal de la bomba.

Hay pulsos de 1-10 segundos y continuo hasta Apagar, con una bomba a la vez.
El continuo no termina al cerrar la página. El corte local por 30 segundos sin
respuesta del servidor sigue activo. No se restaura un encendido tras reinicio.
Nunca usar encendidos reales como prueba automática de instalación.

### Estado real de los sensores

El código recibe 15 parámetros de ambiente, solución, nivel y distancias.
El pH requiere verificar conexión y calibración. TDS sigue sin calibración
verificada y EC se estima desde TDS. El nivel resistivo es respuesta eléctrica
relativa; el ensayo de media inmersión no reprodujo el 50%, por lo que no debe
presentarse como altura ni volumen validado. Los errores o falta de eco no son cero.

Mapa J17: pH 1, TDS 2, nivel resistivo 3, DHT11 10, DS18B20 11,
I2C SDA/SCL 8/9, MH-Z19 RX/TX 16/17. Los cinco ultrasónicos usan
TRIG/ECHO 4/5, 6/7, 12/13, 14/15 y 18/21. Verificar el acondicionamiento
eléctrico antes de conectar; esta guía no autoriza cambios de cableado.

### Cámara

Configurar CAMERA_MJPEG_URL con http://IP_CAMARA:81/stream. La IP de la plantilla
es un ejemplo, no detección automática. Node obtiene la foto y el video por red;
el USB de la cámara no transmite el video a la página.
La foto HD se actualiza cada hora o con Actualizar imagen. El video es opcional.
El perfil base conserva foto QXGA 2048x1536 y video UXGA 1600x1200.
La plantilla deja el flash de análisis apagado.

Con CAMERA_CAPTURE_TARGET=screen se utiliza el laboratorio de tablet.
La interfaz de operación no lo presenta como diagnóstico de plantas reales.
Cambiar a plant solo con una planta real y un montaje adecuado; no porque se
esté estrenando otra PC. La cámara no necesita reflashearse solo por mudar el servidor.

<!-- pagebreak -->

## 6. Comprobar y resolver problemas

Desde otra terminal, con Node iniciado:

```powershell
Invoke-RestMethod http://localhost:4173/api/health
$s = Invoke-RestMethod http://localhost:4173/api/bootstrap
$s.meta
$s.actuators | Select-Object id,pin,active,stale,controllable
```

Con hardware conectado, comprobar fechas recientes, source esp32-wifi y
firmwareBuild tesis-huerta-j17-wifi-v3. Deben existir las salidas relay-39,
relay-40, relay-47 y relay-41. Un active null o stale true significa que no se
puede confirmar el estado; no significa apagada.

En la web, revisar las cinco vistas, el historial por parámetro, las advertencias
de calidad y las cuatro tarjetas. Probar foto y video solo si la cámara está
disponible. cameraMode mjpeg indica configuración, no prueba que la cámara responda.
No forzar mediciones, ocultar calibraciones pendientes ni crear datos ficticios.

| Problema | Revisión segura |
| --- | --- |
| No abre localhost:4173 | Revisar que Node esté ejecutándose y que el puerto no lo ocupe otro proceso. No terminar procesos ajenos sin verificar. |
| La web abre, pero no hay sensores | Revisar alimentación, misma red, WEB_INGEST_URL, identidad y token. Clonar no redirige la placa. |
| HTTP 401 al publicar | El token de la placa y el del servidor no coinciden. Corregir en privado, sin imprimirlos. |
| La cuarta bomba no está habilitada | La placa todavía no informa las cuatro salidas o usa firmware anterior. No inventar su estado. |
| Cámara sin imagen | Comprobar su alimentación, IP y acceso desde la PC. No reemplazarla con una foto simulada. |
| Otra pantalla no puede operar bombas | Habilitar el control con la clave privada, en una LAN de confianza. |

Si Windows bloquea la red, limitar cualquier permiso al puerto 4173 y a la red
privada necesaria. No desactivar el firewall, abrir puertos del router ni publicar
la instalación en Internet. Para acceso remoto, coordinar una VPN o arquitectura
autenticada con el responsable; no exponer este servidor directamente.

Los tests se ejecutan con node --test tests/*.test.js. Algunas pruebas de visión
se omiten si faltan fotos privadas o la dependencia opcional sharp; eso no valida
esas fotos. No instalar dependencias opcionales solo para abrir la web.

<!-- pagebreak -->

## 7. Entrega al compañero

Compartir el enlace del repositorio, este documento o su PDF y
PROMPT_PARA_COMPANERO.md. No hace falta compartir toda la conversación.
El prompt está pensado para un asistente con acceso a archivos y terminal;
si no dispone de esas herramientas, debe dar instrucciones verificables.

Antes de dar el traslado por terminado:

- Registrar la rama y el commit realmente descargados.
- Confirmar si solo se abrió la interfaz o si hay conexión real con las placas.
- Dejar la URL correcta: localhost en la PC servidora o su IPv4 desde otra pantalla.
- Informar qué configuraciones privadas faltan, sin mostrar sus valores.
- Verificar la cuarta bomba en GPIO41, sin activar ninguna salida para probar.
- Conservar las advertencias de pH, TDS, EC y nivel resistivo.
- Mantener encendidos la PC servidora y los equipos cuando se requieran datos.

### Prompt de inicio

```text
Quiero ejecutar HydroVision en esta computadora desde:
https://github.com/FacundoMatiasHernandez/WebHidroponia

Leé primero README.md y app/docs/new-notebook-setup.md.
Si tenés terminal y archivos, cloná o actualizá main sin descartar
cambios locales, ejecutá las pruebas e iniciá la web en el puerto 4173.
Con Node 24 alcanza: node server.js; no hace falta npm install.

Primero dejá visible la página aunque todavía no tenga placas.
Después preguntame si voy a usar la instalación existente o mudar
el servidor. No inventes lecturas, IP, claves ni conexiones.
El firmware actual de cuatro bombas es tesis_huerta_j17_wifi_v3.
La cuarta bomba usa GPIO41, no GPIO42.
No enciendas bombas ni cargues firmware sin mi confirmación de seguridad.
Las credenciales y calibraciones locales no están en Git:
pedime configurarlas en privado si hacen falta.
Si no tenés herramientas para ejecutarlo, guiame paso a paso
y distinguí lo que comprobaste de lo que todavía falta.
```

### Documentación de apoyo

- README.md: índice del proyecto.
- app/docs/esp32-wifi-control.md: comunicación, seguridad y nivel resistivo.
- firmware/tesis_huerta_j17_wifi_v3/README.md: cuatro bombas y compilación.
- app/simulator/README.md: laboratorio separado con tablet.
- app/docs/esp32-usb-setup.md: diagnóstico alternativo por USB; no iniciarlo junto al modo Wi-Fi.

Los PDF técnicos anteriores de septiembre son material histórico. Esta guía,
el código y los README actuales prevalecen para la instalación de noviembre.
