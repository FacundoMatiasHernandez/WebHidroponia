#include <DHT.h>
#include <HTTPClient.h>
#include <WiFi.h>

#include "secrets.h"

const uint16_t WEB_PORT = 4173;
const char *WEB_INGEST_PATH = "/api/ingest/batch";

const bool USE_STATIC_IP = false;
IPAddress ESP32_LOCAL_IP(192, 168, 100, 50);
IPAddress ESP32_GATEWAY(192, 168, 100, 1);
IPAddress ESP32_SUBNET(255, 255, 255, 0);
IPAddress ESP32_DNS(192, 168, 100, 1);

const bool USE_DHT_SENSOR = true;
const bool USE_HCSR04_SENSOR = true;
const bool USE_WATER_SENSOR = true;
const bool USE_PH_SENSOR = false;

const uint8_t DHT_PIN = 4;
#define DHTTYPE DHT11

const uint8_t HCSR04_TRIG_PIN = 5;
const uint8_t HCSR04_ECHO_PIN = 6;
const uint8_t WATER_PIN = 7;
const uint8_t PH_PIN = 1;

const unsigned long READ_INTERVAL_MS = 5000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
const unsigned long ECHO_TIMEOUT_US = 30000;
const float SOUND_SPEED_CM_PER_US = 0.0343;

const float WATER_FULL_DISTANCE_CM = 5.0;
const float WATER_EMPTY_DISTANCE_CM = 25.0;

const uint8_t WATER_SAMPLE_COUNT = 20;
const int WATER_DRY_VALUE = 0;
const int WATER_WET_VALUE = 2500;

const uint8_t PH_SAMPLE_COUNT = 40;
const float ADC_REFERENCE_VOLTAGE = 3.3;
const int ADC_MAX_VALUE = 4095;
const float DIVIDER_TOP_OHMS = 10000.0;
const float DIVIDER_BOTTOM_OHMS = 20000.0;
const float DIVIDER_MULTIPLIER = (DIVIDER_TOP_OHMS + DIVIDER_BOTTOM_OHMS) / DIVIDER_BOTTOM_OHMS;
const float CAL_PH_LOW = 2.80;
const float CAL_LOW_VOLTAGE = 3.243;
const float CAL_PH_HIGH = 8.30;
const float CAL_HIGH_VOLTAGE = 2.534;

DHT dht(DHT_PIN, DHTTYPE);
WiFiClient httpClient;

unsigned long lastReadingAt = 0;
unsigned long lastWifiAttemptAt = 0;
uint32_t sequenceNumber = 0;
bool ledOn = false;

void writeStatusLed(uint8_t red, uint8_t green, uint8_t blue) {
#if defined(RGB_BUILTIN)
  rgbLedWrite(RGB_BUILTIN, red, green, blue);
#elif defined(LED_BUILTIN)
  digitalWrite(LED_BUILTIN, green > 0 || blue > 0 ? HIGH : LOW);
#endif
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - lastWifiAttemptAt < WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }

  lastWifiAttemptAt = millis();
  Serial.print("Conectando WiFi a ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  if (USE_STATIC_IP) {
    Serial.print("Usando IP fija ESP32: ");
    Serial.println(ESP32_LOCAL_IP);

    if (!WiFi.config(ESP32_LOCAL_IP, ESP32_GATEWAY, ESP32_SUBNET, ESP32_DNS)) {
      Serial.println("No pude aplicar WiFi.config().");
    }
  }

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAt < 8000) {
    delay(250);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi OK. IP ESP32: ");
    Serial.println(WiFi.localIP());
    writeStatusLed(0, 32, 0);
  } else {
    Serial.println("No pude conectar a WiFi.");
    writeStatusLed(32, 0, 0);
  }
}

String webIngestUrl() {
  String url = "http://";
  url += WEB_HOST;
  url += ":";
  url += WEB_PORT;
  url += WEB_INGEST_PATH;
  return url;
}

float readDistanceCm() {
  digitalWrite(HCSR04_TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(HCSR04_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(HCSR04_TRIG_PIN, LOW);

  unsigned long duration = pulseIn(HCSR04_ECHO_PIN, HIGH, ECHO_TIMEOUT_US);
  if (duration == 0) {
    return NAN;
  }

  return (duration * SOUND_SPEED_CM_PER_US) / 2.0;
}

float waterLevelFromDistance(float distanceCm) {
  float percent = ((WATER_EMPTY_DISTANCE_CM - distanceCm) / (WATER_EMPTY_DISTANCE_CM - WATER_FULL_DISTANCE_CM)) * 100.0;
  return constrain(percent, 0.0, 100.0);
}

int readWaterRaw() {
  long total = 0;

  for (uint8_t i = 0; i < WATER_SAMPLE_COUNT; i++) {
    total += analogRead(WATER_PIN);
    delay(5);
  }

  return total / WATER_SAMPLE_COUNT;
}

float waterLevelFromRaw(int rawValue) {
  int percent = map(rawValue, WATER_DRY_VALUE, WATER_WET_VALUE, 0, 100);
  return constrain(percent, 0, 100);
}

int readPhRaw() {
  long total = 0;

  for (uint8_t i = 0; i < PH_SAMPLE_COUNT; i++) {
    total += analogRead(PH_PIN);
    delay(10);
  }

  return total / PH_SAMPLE_COUNT;
}

float rawToVoltage(int rawValue) {
  return (rawValue * ADC_REFERENCE_VOLTAGE) / ADC_MAX_VALUE;
}

float voltageToPh(float poVoltage) {
  float slope = (CAL_PH_HIGH - CAL_PH_LOW) / (CAL_HIGH_VOLTAGE - CAL_LOW_VOLTAGE);
  float intercept = CAL_PH_LOW - (slope * CAL_LOW_VOLTAGE);
  return (slope * poVoltage) + intercept;
}

void addReading(String &payload, bool &hasReading, const char *sensorId, float value, uint8_t decimals) {
  if (isnan(value)) {
    return;
  }

  if (hasReading) {
    payload += ",";
  }

  payload += "{\"sensorId\":\"";
  payload += sensorId;
  payload += "\",\"value\":";
  payload += String(value, static_cast<unsigned int>(decimals));
  payload += "}";
  hasReading = true;
}

bool sendToWeb(String payload) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  String url = webIngestUrl();

  Serial.print("Enviando a web: ");
  Serial.println(url);
  Serial.println(payload);

  http.begin(httpClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept", "application/json");

  int statusCode = http.POST(payload);
  String response = http.getString();

  Serial.print("HTTP status: ");
  Serial.println(statusCode);
  if (statusCode < 0) {
    Serial.print("HTTP error: ");
    Serial.println(http.errorToString(statusCode));
  }

  if (response.length() > 0) {
    Serial.print("Respuesta web: ");
    Serial.println(response);
  }

  http.end();
  return statusCode >= 200 && statusCode < 300;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

#if defined(LED_BUILTIN) && !defined(RGB_BUILTIN)
  pinMode(LED_BUILTIN, OUTPUT);
#endif

  if (USE_DHT_SENSOR) {
    dht.begin();
  }

  if (USE_HCSR04_SENSOR) {
    pinMode(HCSR04_TRIG_PIN, OUTPUT);
    pinMode(HCSR04_ECHO_PIN, INPUT);
    digitalWrite(HCSR04_TRIG_PIN, LOW);
  }

  analogReadResolution(12);
  if (USE_WATER_SENSOR) {
    analogSetPinAttenuation(WATER_PIN, ADC_11db);
  }
  if (USE_PH_SENSOR) {
    analogSetPinAttenuation(PH_PIN, ADC_11db);
  }

  writeStatusLed(0, 0, 0);

  Serial.println();
  Serial.println("ESP32-S3 sensores -> WebHidroponia directo");
  Serial.println("DHT11 DATA: GPIO 4");
  Serial.println("HC-SR04 TRIG: GPIO 5 | ECHO: GPIO 6");
  Serial.println("Sensor de agua SIGNAL: GPIO 7");
  Serial.println("pH: desactivado por defecto");
  Serial.println("Monitor serial: 115200 baud");
}

void loop() {
  connectWifi();

  if (millis() - lastReadingAt < READ_INTERVAL_MS) {
    return;
  }

  lastReadingAt = millis();
  ledOn = !ledOn;
  sequenceNumber++;

  float humidity = NAN;
  float temperature = NAN;
  float distanceCm = NAN;
  float waterLevelPercent = NAN;
  int waterRaw = -1;
  float phValue = NAN;

  if (USE_DHT_SENSOR) {
    humidity = dht.readHumidity();
    temperature = dht.readTemperature();
  }

  if (USE_HCSR04_SENSOR) {
    distanceCm = readDistanceCm();
    if (!isnan(distanceCm)) {
      waterLevelPercent = waterLevelFromDistance(distanceCm);
    }
  }

  if (USE_WATER_SENSOR) {
    waterRaw = readWaterRaw();
    if (isnan(waterLevelPercent)) {
      waterLevelPercent = waterLevelFromRaw(waterRaw);
    }
  }

  if (USE_PH_SENSOR) {
    int phRaw = readPhRaw();
    float gpioVoltage = rawToVoltage(phRaw);
    float poVoltage = gpioVoltage * DIVIDER_MULTIPLIER;
    phValue = voltageToPh(poVoltage);
  }

  String payload = "{\"source\":\"esp32-direct\",\"readings\":[";
  bool hasReading = false;
  addReading(payload, hasReading, "air-temperature", temperature, 1);
  addReading(payload, hasReading, "air-humidity", humidity, 1);
  addReading(payload, hasReading, "water-level", waterLevelPercent, 0);
  addReading(payload, hasReading, "water-ph", phValue, 2);
  payload += "],\"actuators\":[";
  payload += "{\"id\":\"esp32-link\",\"label\":\"ESP32 directa\",\"active\":true,\"detail\":\"Ultima secuencia ";
  payload += sequenceNumber;
  payload += "\"}";
  payload += "]}";

  Serial.println();
  Serial.println("===== Lectura de sensores =====");
  Serial.print("Temperatura: ");
  Serial.print(temperature, 1);
  Serial.print(" C | Humedad: ");
  Serial.print(humidity, 1);
  Serial.println(" %");

  Serial.print("Distancia HC-SR04: ");
  Serial.print(distanceCm, 1);
  Serial.print(" cm | Nivel estimado: ");
  Serial.print(waterLevelPercent, 0);
  Serial.println(" %");

  Serial.print("Sensor agua RAW: ");
  Serial.println(waterRaw);

  if (USE_PH_SENSOR) {
    Serial.print("pH estimado: ");
    Serial.println(phValue, 2);
  }

  if (!hasReading) {
    Serial.println("No hay lecturas validas para enviar.");
    writeStatusLed(32, 0, 0);
    return;
  }

  bool sent = sendToWeb(payload);
  if (sent) {
    writeStatusLed(0, ledOn ? 32 : 0, ledOn ? 32 : 0);
  } else {
    writeStatusLed(32, 0, 0);
  }
}
