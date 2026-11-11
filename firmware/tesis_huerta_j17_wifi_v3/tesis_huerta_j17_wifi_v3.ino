#include <WiFi.h>
#include <HTTPClient.h>
#include <cJSON.h>
#include <driver/gpio.h>
#include <esp_system.h>
#include "secrets.h"
#include "sensores_j17.h"

const unsigned long MAX_PUMP_MS = 10000;
const unsigned long CONTACT_TIMEOUT_MS = 30000;
const unsigned long SEND_INTERVAL_MS = 2000;
struct PumpState {
  bool active = false;
  bool continuous = false;
  bool safeOff = false;
  unsigned long startedAt = 0;
  unsigned long durationMs = 0;
  String commandId;
  const char *result = "none";
};
PumpState pumps[RELAY_COUNT];
SemaphoreHandle_t pumpMutex;
unsigned long lastContactAt = 0, lastSendAt = 0, lastWifiAttemptAt = 0;
uint32_t sequenceNumber = 0;
String bootId;

bool anyPumpActive() {
  for (uint8_t i = 0; i < RELAY_COUNT; i++) if (pumps[i].active) return true;
  return false;
}

void stopPump(uint8_t index, const char *result, bool safeOff = false) {
  if (index >= RELAY_COUNT) return;
  escribirRele(index, false);
  pumps[index].active = false;
  pumps[index].continuous = false;
  pumps[index].safeOff = safeOff;
  pumps[index].result = result;
}

// Dedicated local watchdog: pulses expire; continuous operation still needs the server heartbeat.
void pumpSafetyTask(void *) {
  for (;;) {
    xSemaphoreTake(pumpMutex, portMAX_DELAY);
    const unsigned long now = millis();
    for (uint8_t i = 0; i < RELAY_COUNT; i++) {
      if (pumps[i].active && !pumps[i].continuous && now - pumps[i].startedAt >= pumps[i].durationMs) stopPump(i, "completed");
      if (now - lastContactAt >= CONTACT_TIMEOUT_MS && pumps[i].active) stopPump(i, "failsafe", true);
    }
    xSemaphoreGive(pumpMutex);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void addReading(cJSON *readings, const char *id, float value, const char *note = nullptr) {
  cJSON *entry = cJSON_CreateObject();
  cJSON_AddStringToObject(entry, "sensorId", id);
  if (isfinite(value)) cJSON_AddNumberToObject(entry, "value", value);
  else { cJSON_AddNullToObject(entry, "value"); cJSON_AddStringToObject(entry, "status", "error"); }
  if (note) cJSON_AddStringToObject(entry, "note", note);
  cJSON_AddItemToArray(readings, entry);
}

void addDiagnostic(cJSON *entry, uint8_t pin, int raw, uint32_t mv) {
  if (raw < 0) return;
  cJSON *d = cJSON_AddObjectToObject(entry, "diagnostic");
  cJSON_AddNumberToObject(d, "pin", pin);
  cJSON_AddNumberToObject(d, "raw", raw);
  cJSON_AddNumberToObject(d, "millivolts", mv);
}

String makeTelemetry() {
  cJSON *root = cJSON_CreateObject();
  if (!root) return "";
  cJSON_AddStringToObject(root, "source", "esp32-wifi");
  cJSON_AddStringToObject(root, "firmwareProfile", "tesis-huerta-j17");
  cJSON_AddStringToObject(root, "firmwareBuild", "tesis-huerta-j17-wifi-v3");
  cJSON_AddBoolToObject(root, "fullSnapshot", true);
  cJSON *device = cJSON_AddObjectToObject(root, "device");
  cJSON_AddStringToObject(device, "id", ESP32_DEVICE_ID);
  cJSON_AddStringToObject(device, "bootId", bootId.c_str());
  cJSON_AddNumberToObject(device, "sequence", ++sequenceNumber);
  cJSON_AddNumberToObject(device, "protocol", 1);
  cJSON_AddStringToObject(device, "capability", "four-timed-continuous-pumps-v3");
  cJSON_AddStringToObject(device, "ip", WiFi.localIP().toString().c_str());
  cJSON *readings = cJSON_AddArrayToObject(root, "readings");
  addReading(readings, "air-temperature", data.tempAmb);
  addReading(readings, "air-humidity", data.humAmb);
  addReading(readings, "air-co2", data.co2 > 0 ? data.co2 : NAN);
  addReading(readings, "light-intensity", data.lux);
  addReading(readings, "water-temperature", data.tempAgua);
  addReading(readings, "water-ph", data.ph, "Calibracion pendiente. Revisar la pista de senal de pH antes de usar este valor.");
  cJSON *ph = cJSON_GetArrayItem(readings, cJSON_GetArraySize(readings) - 1);
  cJSON_AddStringToObject(ph, "calibration", "pending");
  addDiagnostic(ph, PIN_PH, phRawDiagnostic, phMilliVoltsDiagnostic);
  addReading(readings, "water-tds", data.tds, "Lectura TDS con calibracion pendiente.");
  cJSON *tds = cJSON_GetArrayItem(readings, cJSON_GetArraySize(readings) - 1);
  cJSON_AddStringToObject(tds, "calibration", "pending");
  addDiagnostic(tds, PIN_TDS, tdsRawDiagnostic, tdsMilliVoltsDiagnostic);
  addReading(readings, "water-ec", data.tds / 500.0f, "EC estimada desde TDS con el factor 0.5 del firmware J17; no calibrada.");
  cJSON *ec = cJSON_GetArrayItem(readings, cJSON_GetArraySize(readings) - 1);
  cJSON_AddStringToObject(ec, "quality", "estimated");
  addDiagnostic(ec, PIN_TDS, tdsRawDiagnostic, tdsMilliVoltsDiagnostic);
  addReading(readings, "water-level-raw", data.nivelResRaw >= 0 ? data.nivelResRaw : NAN);
  addReading(readings, "water-level", NAN, "Falta calibrar las alturas del tanque; ver las distancias y RAW.");
  cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetArrayItem(readings, cJSON_GetArraySize(readings) - 1), "status", cJSON_CreateString("uncalibrated"));
  for (uint8_t i = 0; i < 5; i++) {
    const String id = "distance-" + String(i + 1);
    addReading(readings, id.c_str(), data.distanciaCm[i], isnan(data.distanciaCm[i]) ? "Sin eco" : nullptr);
  }
  cJSON *actuators = cJSON_AddArrayToObject(root, "actuators");
  xSemaphoreTake(pumpMutex, portMAX_DELAY);
  for (uint8_t i = 0; i < RELAY_COUNT; i++) {
    cJSON *a = cJSON_CreateObject();
    const String id = "relay-" + String(RELAY_PINS[i]);
    cJSON_AddStringToObject(a, "id", id.c_str());
    cJSON_AddNumberToObject(a, "pin", RELAY_PINS[i]);
    cJSON_AddBoolToObject(a, "active", pumps[i].active);
    cJSON_AddStringToObject(a, "runMode", pumps[i].continuous ? "continuous" : "pulse");
    cJSON_AddNumberToObject(a, "durationMs", pumps[i].continuous ? 0 : pumps[i].durationMs);
    cJSON_AddStringToObject(a, "mode", pumps[i].safeOff ? "safe-off" : "manual");
    cJSON_AddStringToObject(a, "result", pumps[i].result);
    if (pumps[i].commandId.length()) cJSON_AddStringToObject(a, "commandId", pumps[i].commandId.c_str());
    else cJSON_AddNullToObject(a, "commandId");
    cJSON_AddItemToArray(actuators, a);
  }
  xSemaphoreGive(pumpMutex);
  char *text = cJSON_PrintUnformatted(root);
  String payload = text ? String(text) : String("");
  cJSON_free(text); cJSON_Delete(root);
  return payload;
}

bool validIdentifier(const cJSON *value) {
  if (!cJSON_IsString(value)) return false;
  const String s(value->valuestring);
  if (!s.length() || s.length() > 64) return false;
  for (size_t i = 0; i < s.length(); i++) if (!isalnum(static_cast<unsigned char>(s[i])) && s[i] != '-' && s[i] != '_') return false;
  return true;
}

void acceptControl(const String &body, unsigned long requestStartedAt) {
  if (body.length() > 8192) return;
  cJSON *root = cJSON_Parse(body.c_str());
  if (!root) return;
  const cJSON *ok = cJSON_GetObjectItemCaseSensitive(root, "ok");
  const cJSON *control = cJSON_GetObjectItemCaseSensitive(root, "control");
  const cJSON *id = cJSON_GetObjectItemCaseSensitive(control, "deviceId");
  const cJSON *boot = cJSON_GetObjectItemCaseSensitive(control, "bootId");
  const cJSON *sequence = cJSON_GetObjectItemCaseSensitive(control, "sequence");
  const cJSON *lease = cJSON_GetObjectItemCaseSensitive(control, "controlLeaseMs");
  const cJSON *commands = cJSON_GetObjectItemCaseSensitive(control, "commands");
  if (!cJSON_IsTrue(ok) || !cJSON_IsString(id) || strcmp(id->valuestring, ESP32_DEVICE_ID)
      || !cJSON_IsString(boot) || bootId != boot->valuestring || !cJSON_IsNumber(sequence) || sequence->valuedouble != sequenceNumber
      || !cJSON_IsNumber(lease) || lease->valueint != CONTACT_TIMEOUT_MS || !cJSON_IsArray(commands) || cJSON_GetArraySize(commands) > RELAY_COUNT) {
    cJSON_Delete(root); return;
  }
  xSemaphoreTake(pumpMutex, portMAX_DELAY);
  lastContactAt = millis();
  const cJSON *command;
  cJSON_ArrayForEach(command, commands) {
    const cJSON *relay = cJSON_GetObjectItemCaseSensitive(command, "id");
    const cJSON *commandId = cJSON_GetObjectItemCaseSensitive(command, "commandId");
    const cJSON *mode = cJSON_GetObjectItemCaseSensitive(command, "mode");
    const cJSON *active = cJSON_GetObjectItemCaseSensitive(command, "active");
    const cJSON *duration = cJSON_GetObjectItemCaseSensitive(command, "durationMs");
    const cJSON *runMode = cJSON_GetObjectItemCaseSensitive(command, "runMode");
    const cJSON *expires = cJSON_GetObjectItemCaseSensitive(command, "expiresInMs");
    if (!cJSON_IsString(relay) || !validIdentifier(commandId) || !cJSON_IsString(mode) || strcmp(mode->valuestring, "manual")
      || !cJSON_IsBool(active) || !cJSON_IsString(runMode) || !cJSON_IsNumber(duration) || !cJSON_IsNumber(expires) || expires->valuedouble > 15000
      || expires->valuedouble <= millis() - requestStartedAt || duration->valuedouble != duration->valueint) continue;
    const bool continuous = strcmp(runMode->valuestring, "continuous") == 0;
    if (!continuous && strcmp(runMode->valuestring, "pulse")) continue;
    if (continuous && (!cJSON_IsTrue(active) || duration->valueint != 0)) continue;
    if (!cJSON_IsTrue(active) && duration->valueint != 0) continue;
    if (cJSON_IsTrue(active) && !continuous && (duration->valueint < 1000 || duration->valueint > MAX_PUMP_MS)) continue;
    for (uint8_t i = 0; i < RELAY_COUNT; i++) {
      const String expected = "relay-" + String(RELAY_PINS[i]);
      if (expected != relay->valuestring || pumps[i].commandId == commandId->valuestring) continue;
      pumps[i].commandId = commandId->valuestring;
      if (cJSON_IsTrue(active) && (anyPumpActive())) {
        pumps[i].result = "rejected"; continue;
      }
      pumps[i].safeOff = false;
      pumps[i].result = "applied";
      pumps[i].durationMs = duration->valueint;
      pumps[i].continuous = continuous;
      pumps[i].startedAt = millis();
      escribirRele(i, cJSON_IsTrue(active));
      pumps[i].active = cJSON_IsTrue(active);
    }
  }
  xSemaphoreGive(pumpMutex);
  cJSON_Delete(root);
}

void publishTelemetry() {
  if (WiFi.status() != WL_CONNECTED) return;
  const String payload = makeTelemetry();
  if (!payload.length()) return;
  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(1000); http.setTimeout(1800);
  if (!http.begin(client, WEB_INGEST_URL)) return;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Ingest-Token", INGEST_TOKEN);
  const unsigned long started = millis();
  const int status = http.POST(payload);
  if (status == 200 && http.getSize() >= 0 && http.getSize() <= 8192) acceptControl(http.getString(), started);
  Serial.printf("WiFi HTTP %d | IP %s | PH ADC %d / %lu mV | TDS ADC %d / %lu mV\n", status,
    WiFi.localIP().toString().c_str(), phRawDiagnostic, (unsigned long)phMilliVoltsDiagnostic,
    tdsRawDiagnostic, (unsigned long)tdsMilliVoltsDiagnostic);
  http.end();
}

void setup() {
  // Preload each confirmed OFF level before enabling the output.
  for (uint8_t i = 0; i < RELAY_COUNT; i++) {
    gpio_set_level((gpio_num_t)RELAY_PINS[i], RELAY_ACTIVE_LOW_BY_INDEX[i] ? HIGH : LOW);
    pinMode(RELAY_PINS[i], OUTPUT);
    escribirRele(i, false);
  }
  iniciarSensores();
  pumpMutex = xSemaphoreCreateMutex();
  if (!pumpMutex || xTaskCreate(pumpSafetyTask, "pump-cutoff", 3072, nullptr, 3, nullptr) != pdPASS) {
    apagarReles();
    Serial.println("ERROR: no se habilita WiFi sin el corte local de bombas");
    for (;;) delay(1000);
  }
  char randomBoot[17]; snprintf(randomBoot, sizeof(randomBoot), "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
  bootId = randomBoot;
  WiFi.persistent(false); WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("J17 WiFi v3 (4 bombas): pulsos de 1 a 10 segundos o continuo manual; apagado tras 30 s sin servidor; sin control por lux.");
}

void loop() {
  const unsigned long now = millis();
  if (now - lastLux >= INTERVAL_LUX_MS) { lastLux = now; if (USE_LUX) leerLuxometro(); }
  if (now - lastDht >= INTERVAL_DHT_MS) { lastDht = now; if (USE_DHT) leerAmbientales(); }
  if (now - lastCo2 >= INTERVAL_CO2_MS) { lastCo2 = now; if (USE_CO2) leerCO2(); }
  if (now - lastAgua >= INTERVAL_AGUA_MS) { lastAgua = now; leerAguaYQuimicos(); }
  if (now - lastNiveles >= INTERVAL_NIVELES_MS) { lastNiveles = now; leerNiveles(); }
  if (WiFi.status() != WL_CONNECTED && now - lastWifiAttemptAt >= 10000) {
    lastWifiAttemptAt = now; WiFi.reconnect();
  }
  if (now - lastSendAt >= SEND_INTERVAL_MS) { lastSendAt = now; publishTelemetry(); }
  delay(5);
}
