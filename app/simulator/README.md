# Simulador local sincronizado

Version local del Site del usuario "Hoja - Laboratorio de huerta".
Origen: `hoja-laboratorio-huerta-7r4m.facundomatias-hernan.chatgpt.site`,
commit del repositorio fuente `3fcd36d`. Se conserva la silueta de la textura
generada y el modelo temporal; el sitio publicado no se modifica.

## Perfil exclusivo de laboratorio

La pantalla sincronizada usa `tablet-leaf-v1`: tejido verde recoloreado,
amarillo por zonas (no transparencia global), peciolo estrecho excluido y seis
firmas de dano ampliadas. La cobertura amarilla del dibujo se define antes
de superponer danos. La intensidad de plaga controla cantidad de marcas,
no porcentaje de superficie ni cantidad biologica de insectos.

La tira inferior contiene referencias constantes y dos extremos magenta.
Debe verse completa junto a la hoja. El detector lee esos colores en cada
foto, excluye la tira de las mediciones y busca firmas dentro de una sola
lamina. No lee intensidades, nombres de casos ni etiquetas esperadas.
Sin tira valida, hoja completa y dos fotos comparables no hay lectura valida.
Una hoja amarilla completa no depende de conservar tejido verde.

Las firmas son deliberadamente contrastadas: colonias marrones, marcas blancas,
puntos rojizos, trazos plateados con tinte violeta, galerias crema y perforaciones
oscuras. Son simbolos de ensayo, no un clasificador de especies. Los colores
calibran una tarea cerrada; no demuestran reconocimiento de hojas arbitrarias.
El perfil general de plantas sigue separado y no se usa como alternativa si
falla la prueba de tablet. Para volver a plantas reales hay que cambiar
`CAMERA_CAPTURE_TARGET=plant` y reiniciar el servidor.

## Conexion

1. Iniciar HydroVision con `CAMERA_CAPTURE_TARGET=screen`.
2. En la PC abrir `http://localhost:4173/simulador/control`.
3. En la tablet abrir `http://<IP_PC>:4173/simulador/` en la misma red y tocar
   **Iniciar pantalla**. El panel muestra la URL local actual.
4. Elegir la pantalla correcta si hay varias. Aplicar un caso y esperar **lista**.
5. Usar **Capturar y evaluar** en el panel de control del laboratorio.
   La interfaz de operacion mantiene deshabilitado el analisis de plantas
   cuando la camara esta configurada con `CAMERA_CAPTURE_TARGET=screen`.

**Reevaluar foto guardada** usa la misma rafaga y conserva su fecha de captura;
no exige una tablet conectada ni representa lo que muestra en ese momento.
Solo cambia la fecha y version del analisis. La tabla identifica la version
del algoritmo para no confundir reanalisis con ensayos independientes.

La tablet sigue usando el navegador; no necesita Codex abierto. No usar
`localhost` desde la tablet. La PC debe permanecer encendida con Node activo.
Las solicitudes que cambian el caso se aceptan solo desde las direcciones
locales de la PC, con comprobacion de Host/Origin. No se abre acceso a Internet.
No se puede controlar el brillo fisico, el foco del lente ni el bloqueo del
sistema operativo desde este programa.

## Protocolo

`GET /api/simulator/state` muestra el caso, la sesion y la revision.
`POST /api/simulator/state` acepta `{config, expectedRevision}`; campos admitidos:
`yellow`, `aphids`, `whitefly`, `mites`, `thrips`, `miners`, `caterpillars` (0-100),
`day` (0-30), `background` (light/gray/dark), `zoom` (0.75-1.5), `rotation`
(-180 a 180), `chart` (booleano), `name` (maximo 80 caracteres) y
`renderProfile` (solo `tablet-leaf-v1`). Un navegador con renderer antiguo
no puede confirmar capturas: recargar y pulsar Iniciar pantalla.

La pantalla se registra con un token efimero privado y confirma sesion, revision,
visibilidad, texturas cargadas y dimensiones despues del dibujo. SSE notifica
los cambios; una consulta cada 2.5 segundos recupera desconexiones. La carta de
enfoque no se clasifica como una hoja. Un cambio de tamano o pestaña invalida
la disponibilidad hasta volver a dibujar. Cada reinicio exige un nuevo registro.

`POST /api/simulator/capture` exige una confirmacion de menos de 8 segundos.
Bloquea cambios durante la rafaga y comprueba de nuevo la pantalla al terminar.
No captura si la tablet falta, esta oculta o tiene otro caso. El acuse confirma
el estado del navegador, no demuestra que la camara este apuntando a esa tablet.

Cada captura incluye `simulator` con parametros, sesion, revision, pantalla y
dimensiones, ademas de `captureSettings` para la camara. Se guarda un archivo
`data/plant-captures/case-<burst>.json` con las referencias a las tres fotos.
Los analisis conservan estos metadatos. El historial no compara casos distintos
ni mezcla las pruebas con hojas reales. Los cambios de caso se guardan en
`data/simulator-state.json` (privado, excluido de Git).

El panel de laboratorio usa su perfil especializado y guarda la version
del analizador. La interfaz de operacion no muestra estos ensayos como
diagnosticos del cultivo. Los resultados de versiones previas se conservan
como historicos, no se presentan como una nueva medicion del detector actualizado.
Los parametros del simulador siguen siendo distintos de la medicion de la foto.
