#pragma once
// Sensor readers and pin map preserved from the J17 diagnostic. No lux-driven pump control.
#include <Wire.h>
#include <DHT.h>
#include <MHZ19.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ===================== CONFIGURACION GENERAL =====================

#define DHTTYPE DHT11   // Cambiar a DHT22 si usas DHT22 / AM2302

// Polarity is defined per output below; confirmed for this installation.

// Activar solo los modulos conectados durante las pruebas.
const bool USE_LUX = true;
const bool USE_DHT = true;
const bool USE_CO2 = true;
const bool USE_DS18B20 = true;
const bool USE_PH = true;
const bool USE_TDS = true;
const bool USE_NIVEL_RES = true;
const bool USE_ULTRASONICOS = true;
const bool USE_RELES = true;

const float LUX_RELES_ON = 500.0;
const float LUX_RELES_OFF = 400.0;

// ===================== PINES =====================

// Analogicos
#define PIN_PH          1
#define PIN_TDS         2
#define PIN_NIVEL_RES   3

// Ultrasonicos HC-SR04
#define US1_TRIG 4
#define US1_ECHO 5

#define US2_TRIG 6
#define US2_ECHO 7

#define US3_TRIG 12
#define US3_ECHO 13

#define US4_TRIG 14
#define US4_ECHO 15

#define US5_TRIG 18
#define US5_ECHO 21

// I2C luxometro GY-49 / MAX44009
#define PIN_SDA 8
#define PIN_SCL 9

// DHT y DS18B20
#define PIN_DHT     10
#define PIN_DS18B20 11

// MH-Z19 CO2
#define PIN_MHZ_RX 16  // TX del sensor hacia RX ESP32
#define PIN_MHZ_TX 17  // RX del sensor hacia TX ESP32

// Reles
const uint8_t RELAY_PINS[] = {39, 40, 47, 41};  // Existing three pumps, then fourth on GPIO41
const uint8_t RELAY_COUNT = sizeof(RELAY_PINS) / sizeof(RELAY_PINS[0]);
const bool RELAY_ACTIVE_LOW_BY_INDEX[] = {true, true, false, true};
static_assert(RELAY_COUNT == 4, "The v3 telemetry requires four pump outputs");
static_assert(sizeof(RELAY_ACTIVE_LOW_BY_INDEX) / sizeof(RELAY_ACTIVE_LOW_BY_INDEX[0]) == RELAY_COUNT, "Each pump needs an OFF polarity");

// ===================== OBJETOS =====================

DHT dht(PIN_DHT, DHTTYPE);

OneWire oneWire(PIN_DS18B20);
DallasTemperature ds18b20(&oneWire);

HardwareSerial mhzSerial(1);
MHZ19 mhz19;

// ===================== DATOS DEL SISTEMA =====================

struct SistemaData {
  float lux = NAN;
  int co2 = -1;
  int tempCO2 = -100;

  float tempAmb = NAN;
  float humAmb = NAN;

  float tempAgua = NAN;
  float ph = NAN;
  float tds = NAN;

  int nivelResRaw = -1;

  float distanciaCm[5] = {NAN, NAN, NAN, NAN, NAN};
};

SistemaData data;
int ds18b20Count = 0;
int phRawDiagnostic = -1;
int tdsRawDiagnostic = -1;
uint32_t phMilliVoltsDiagnostic = 0;
uint32_t tdsMilliVoltsDiagnostic = 0;
bool relesPorLuxEncendidos = false;

// ===================== TIEMPOS =====================

unsigned long lastLux = 0;
unsigned long lastDht = 0;
unsigned long lastCo2 = 0;
unsigned long lastAgua = 0;
unsigned long lastNiveles = 0;
unsigned long lastPrint = 0;

const unsigned long INTERVAL_LUX_MS     = 2000;
const unsigned long INTERVAL_DHT_MS     = 5000;
const unsigned long INTERVAL_CO2_MS     = 10000;
const unsigned long INTERVAL_AGUA_MS    = 10000;
const unsigned long INTERVAL_NIVELES_MS = 1000;
const unsigned long INTERVAL_PRINT_MS   = 3000;

const unsigned long ECHO_TIMEOUT_US = 30000;
const float SOUND_SPEED_CM_PER_US = 0.0343;

// ===================== LUX GY-49 / MAX44009 =====================

uint8_t luxAddr = 0x4A;
bool luxOk = false;

bool i2cDeviceExists(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

bool writeRegister(uint8_t addr, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool buscarLuxometro() {
  if (i2cDeviceExists(0x4A)) {
    luxAddr = 0x4A;
    luxOk = true;
  } else if (i2cDeviceExists(0x4B)) {
    luxAddr = 0x4B;
    luxOk = true;
  } else {
    luxOk = false;
  }

  if (luxOk) {
    writeRegister(luxAddr, 0x02, 0x80);
  }

  return luxOk;
}

bool leerLux(float &lux) {
  if (!luxOk && !buscarLuxometro()) {
    return false;
  }

  Wire.beginTransmission(luxAddr);
  Wire.write(0x03);

  if (Wire.endTransmission(false) != 0) {
    luxOk = false;
    return false;
  }

  if (Wire.requestFrom(luxAddr, (uint8_t)2) != 2) {
    luxOk = false;
    return false;
  }

  uint8_t highByte = Wire.read();
  uint8_t lowByte = Wire.read();

  uint8_t exponent = (highByte >> 4) & 0x0F;
  uint8_t mantissa = ((highByte & 0x0F) << 4) | (lowByte & 0x0F);

  if (exponent == 0x0F) {
    return false;
  }

  lux = (1UL << exponent) * mantissa * 0.045f;
  return true;
}

// ===================== ANALOGICOS =====================

int leerAnalogicoPromedio(uint8_t pin, uint8_t muestras = 30) {
  long suma = 0;

  for (uint8_t i = 0; i < muestras; i++) {
    suma += analogRead(pin);
    delay(5);
  }

  return suma / muestras;
}

// Calibracion pH heredada de tu codigo original
const float ADC_REFERENCE_VOLTAGE = 3.3;
const int ADC_MAX_VALUE = 4095;

const float DIVIDER_TOP_OHMS = 10000.0;
const float DIVIDER_BOTTOM_OHMS = 20000.0;
const float DIVIDER_MULTIPLIER =
  (DIVIDER_TOP_OHMS + DIVIDER_BOTTOM_OHMS) / DIVIDER_BOTTOM_OHMS;

const float CAL_PH_LOW = 2.80;
const float CAL_LOW_VOLTAGE = 3.243;
const float CAL_PH_HIGH = 8.30;
const float CAL_HIGH_VOLTAGE = 2.534;

float rawToVoltage(int rawValue) {
  return (rawValue * ADC_REFERENCE_VOLTAGE) / ADC_MAX_VALUE;
}

float voltageToPh(float voltage) {
  float slope = (CAL_PH_HIGH - CAL_PH_LOW) / (CAL_HIGH_VOLTAGE - CAL_LOW_VOLTAGE);
  float intercept = CAL_PH_LOW - (slope * CAL_LOW_VOLTAGE);
  return (slope * voltage) + intercept;
}

float leerPH() {
  int raw = leerAnalogicoPromedio(PIN_PH, 40);
  phRawDiagnostic = raw;
  phMilliVoltsDiagnostic = analogReadMilliVolts(PIN_PH);
  float gpioVoltage = rawToVoltage(raw);
  float poVoltage = gpioVoltage * DIVIDER_MULTIPLIER;
  return voltageToPh(poVoltage);
}

float leerTDS(float temperature) {
  int raw = leerAnalogicoPromedio(PIN_TDS, 30);
  tdsRawDiagnostic = raw;
  tdsMilliVoltsDiagnostic = analogReadMilliVolts(PIN_TDS);
  float voltage = raw * (3.3 / 4095.0);

  if (isnan(temperature)) {
    temperature = 25.0;
  }

  float compensationCoefficient = 1.0 + 0.02 * (temperature - 25.0);
  float compensationVoltage = voltage / compensationCoefficient;

  float tdsValue =
    (133.42 * compensationVoltage * compensationVoltage * compensationVoltage
    - 255.86 * compensationVoltage * compensationVoltage
    + 857.39 * compensationVoltage) * 0.5;

  return tdsValue;
}

// ===================== ULTRASONICOS =====================

float leerDistanciaCm(uint8_t trigPin, uint8_t echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long duration = pulseIn(echoPin, HIGH, ECHO_TIMEOUT_US);

  if (duration == 0) {
    return NAN;
  }

  return (duration * SOUND_SPEED_CM_PER_US) / 2.0;
}

void leerUltrasonicos() {
  data.distanciaCm[0] = leerDistanciaCm(US1_TRIG, US1_ECHO);
  data.distanciaCm[1] = leerDistanciaCm(US2_TRIG, US2_ECHO);
  data.distanciaCm[2] = leerDistanciaCm(US3_TRIG, US3_ECHO);
  data.distanciaCm[3] = leerDistanciaCm(US4_TRIG, US4_ECHO);
  data.distanciaCm[4] = leerDistanciaCm(US5_TRIG, US5_ECHO);
}

// ===================== RELES =====================

void escribirRele(uint8_t index, bool encendido) {
  if (index >= RELAY_COUNT) return;

  const uint8_t pin = RELAY_PINS[index];
  const bool activoEnBajo = RELAY_ACTIVE_LOW_BY_INDEX[index];

  digitalWrite(pin, (encendido == activoEnBajo) ? LOW : HIGH);
}

void apagarReles() {
  for (uint8_t i = 0; i < RELAY_COUNT; i++) {
    escribirRele(i, false);
  }
}

// ===================== LECTURAS AGRUPADAS =====================

void leerAmbientales() {
  data.humAmb = dht.readHumidity();
  data.tempAmb = dht.readTemperature();
}

void leerCO2() {
  if (!USE_CO2) return;

  data.co2 = mhz19.getCO2();
  data.tempCO2 = mhz19.getTemperature();
}

void leerAguaYQuimicos() {
  if (USE_DS18B20) {
    ds18b20Count = ds18b20.getDeviceCount();

    if (ds18b20Count == 0) {
      ds18b20.begin();
      ds18b20.setResolution(12);
      ds18b20.setWaitForConversion(false);
      ds18b20Count = ds18b20.getDeviceCount();
    }

    if (ds18b20Count > 0) {
      ds18b20.requestTemperatures();
      data.tempAgua = ds18b20.getTempCByIndex(0);
    } else {
      data.tempAgua = NAN;
    }

    if (data.tempAgua == DEVICE_DISCONNECTED_C) {
      data.tempAgua = NAN;
    }
  } else {
    data.tempAgua = NAN;
  }

  data.ph = USE_PH ? leerPH() : NAN;
  data.tds = USE_TDS ? leerTDS(data.tempAgua) : NAN;
}

void leerNiveles() {
  if (USE_ULTRASONICOS) {
    leerUltrasonicos();
  }

  data.nivelResRaw = USE_NIVEL_RES ? leerAnalogicoPromedio(PIN_NIVEL_RES, 20) : -1;
}

void leerLuxometro() {
  if (!USE_LUX) return;

  float lux;

  if (leerLux(lux)) {
    data.lux = lux;
  } else {
    data.lux = NAN;
  }
}

// ===================== DIAGNOSTICO SERIAL =====================

void imprimirFloat(const char *label, float value, const char *unit, uint8_t decimales = 1) {
  Serial.print(label);

  if (isnan(value)) {
    Serial.print("ERROR");
  } else {
    Serial.print(value, decimales);
    Serial.print(" ");
    Serial.print(unit);
  }
}

void mostrarDiagnostico() {
  Serial.println();
  Serial.println("========== LECTURAS SISTEMA ==========");
  Serial.println("Firmware perfil: tesis-huerta-j17-diagnostico-v1");

  imprimirFloat("Lux: ", data.lux, "lux", 2);
  Serial.println();

  Serial.print("CO2: ");
  if (data.co2 <= 0) {
    Serial.print("ERROR");
  } else {
    Serial.print(data.co2);
    Serial.print(" ppm");
  }
  Serial.print(" | Temp MH-Z19: ");
  Serial.print(data.tempCO2);
  Serial.println(" C");

  imprimirFloat("Temp ambiente: ", data.tempAmb, "C", 1);
  Serial.print(" | ");
  imprimirFloat("Humedad: ", data.humAmb, "%", 1);
  Serial.println();

  imprimirFloat("Temp agua: ", data.tempAgua, "C", 2);
  if (USE_DS18B20) {
    Serial.print(" (DS encontrados: ");
    Serial.print(ds18b20Count);
    Serial.print(")");
  }
  Serial.print(" | ");
  imprimirFloat("pH: ", data.ph, "", 2);
  Serial.print(" | ");
  imprimirFloat("TDS: ", data.tds, "ppm", 0);
  Serial.println();
  Serial.print("PH ADC: raw=");
  Serial.print(phRawDiagnostic);
  Serial.print(" | GPIO mV=");
  Serial.println(phMilliVoltsDiagnostic);
  Serial.print("TDS ADC: raw=");
  Serial.print(tdsRawDiagnostic);
  Serial.print(" | GPIO mV=");
  Serial.println(tdsMilliVoltsDiagnostic);
  imprimirFloat("EC estimada: ", data.tds / 0.5f / 1000.0f, "mS/cm", 6);
  Serial.println();

  Serial.print("Matriz resistiva nivel RAW: ");
  Serial.println(data.nivelResRaw);

  for (uint8_t i = 0; i < 5; i++) {
    Serial.print("Ultrasonico ");
    Serial.print(i + 1);
    Serial.print(": ");

    if (isnan(data.distanciaCm[i])) {
      Serial.println("sin eco");
    } else {
      Serial.print(data.distanciaCm[i], 1);
      Serial.println(" cm");
    }
  }

  Serial.print("Reles por lux: ");
  if (!USE_RELES) {
    Serial.println("desactivados");
  } else {
    Serial.print(relesPorLuxEncendidos ? "ENCENDIDOS" : "apagados");
    Serial.print(" | ON >= ");
    Serial.print(LUX_RELES_ON, 0);
    Serial.print(" lux | OFF <= ");
    Serial.print(LUX_RELES_OFF, 0);
    Serial.println(" lux");
  }
  Serial.println("=====================================");
}

// ===================== SETUP =====================

void iniciarSensores() {
  Serial.begin(115200);
  delay(3000);

#ifdef RGB_BUILTIN
  rgbLedWrite(RGB_BUILTIN, 0, 0, 0);
  neopixelWrite(RGB_BUILTIN, 0, 0, 0);
#endif

  Serial.println();
  Serial.println("Iniciando sistema integrado ESP32-S3...");

  // ADC
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_PH, ADC_11db);
  analogSetPinAttenuation(PIN_TDS, ADC_11db);
  analogSetPinAttenuation(PIN_NIVEL_RES, ADC_11db);

  // I2C
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);

  if (buscarLuxometro()) {
    Serial.print("GY-49 encontrado en direccion 0x");
    Serial.println(luxAddr, HEX);
  } else {
    Serial.println("GY-49 no detectado.");
  }

  // DHT
  if (USE_DHT) {
    dht.begin();
  }

  // DS18B20
  if (USE_DS18B20) {
    ds18b20.begin();
    ds18b20.setResolution(12);
    ds18b20.setWaitForConversion(false);
    delay(1000);
    ds18b20.requestTemperatures();
    delay(800);
    ds18b20Count = ds18b20.getDeviceCount();
    Serial.print("DS18B20 encontrados en GPIO");
    Serial.print(PIN_DS18B20);
    Serial.print(": ");
    Serial.println(ds18b20Count);
  }

  // CO2 MH-Z19
  if (USE_CO2) {
    mhzSerial.begin(9600, SERIAL_8N1, PIN_MHZ_RX, PIN_MHZ_TX);
    mhz19.begin(mhzSerial);
    mhz19.autoCalibration(false);
  }

  // Ultrasonicos
  pinMode(US1_TRIG, OUTPUT);
  pinMode(US1_ECHO, INPUT);

  pinMode(US2_TRIG, OUTPUT);
  pinMode(US2_ECHO, INPUT);

  pinMode(US3_TRIG, OUTPUT);
  pinMode(US3_ECHO, INPUT);

  pinMode(US4_TRIG, OUTPUT);
  pinMode(US4_ECHO, INPUT);

  pinMode(US5_TRIG, OUTPUT);
  pinMode(US5_ECHO, INPUT);

  digitalWrite(US1_TRIG, LOW);
  digitalWrite(US2_TRIG, LOW);
  digitalWrite(US3_TRIG, LOW);
  digitalWrite(US4_TRIG, LOW);
  digitalWrite(US5_TRIG, LOW);

  if (USE_RELES) {
    // Reles
    for (uint8_t i = 0; i < RELAY_COUNT; i++) {
      pinMode(RELAY_PINS[i], OUTPUT);
    }

    apagarReles();
  }

  Serial.println("Sistema iniciado.");
  Serial.println("Recordatorio: cada ECHO del HC-SR04 debe tener divisor a 3.3V.");
  Serial.println("Recordatorio: reles con fuente externa 5V y GND comun.");
}
