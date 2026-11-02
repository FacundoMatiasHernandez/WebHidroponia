  #include <Servo.h>

// Uno D2 -> signal. External supply negative -> servo ground and Uno GND.
// Automatically runs 0..180 once per power-on/reset, after 2 seconds.
// T = slow, F = fast, W = wider, A = 0..120..0,
// E = repeat 0..180 without returning, X = stop/cancel automatic start.
Servo servo;
const uint8_t SERVO_PIN = 2;
const int CENTER_US = 1500;
const int TARGETS_US[] = {1500, 1300, 1700, 1500, 1300, 1700, 1500};
const uint8_t TARGET_COUNT = sizeof(TARGETS_US) / sizeof(TARGETS_US[0]);
// Initial wider test only; physical angles/endpoints require observation.
const int WIDE_TARGETS_US[] = {1500, 1000, 2000, 1500};
const uint8_t WIDE_TARGET_COUNT = sizeof(WIDE_TARGETS_US) / sizeof(WIDE_TARGETS_US[0]);
// Nominal software mapping: 0 deg = 1000 us, 180 deg = 2000 us.
// Actual rotation requires mechanical calibration; these are not measured angles.
const int ANGLE_TARGETS_US[] = {1000, 1667, 1000};
const uint8_t ANGLE_TARGET_COUNT = sizeof(ANGLE_TARGETS_US) / sizeof(ANGLE_TARGETS_US[0]);
const int ENDPOINT_TARGETS_US[] = {1000, 2000};
const uint8_t ENDPOINT_TARGET_COUNT = sizeof(ENDPOINT_TARGETS_US) / sizeof(ENDPOINT_TARGETS_US[0]);
bool running = false;
bool fastMode = false;
bool wideMode = false;
bool angleMode = false;
bool endpointMode = false;
uint8_t stage = 0;
int pulseUs = CENTER_US;
unsigned long lastStep = 0;
unsigned long holdStarted = 0;
bool holding = false;
bool autoStartPending = true;
unsigned long startupTime = 0;

void stopTest(bool completed) {
  autoStartPending = false;
  servo.detach();
  pinMode(SERVO_PIN, OUTPUT);
  digitalWrite(SERVO_PIN, LOW);
  digitalWrite(LED_BUILTIN, LOW);
  running = false;
  Serial.println(completed ? F("TEST_DONE SIGNAL_OFF") : F("STOPPED SIGNAL_OFF"));
}

void beginTest(bool fast, bool wide = false, bool angle = false, bool endpoint = false) {
  if (running) {
    Serial.println(F("BUSY"));
    return;
  }
  stage = 0;
  autoStartPending = false;
  fastMode = fast;
  wideMode = wide;
  angleMode = angle;
  endpointMode = endpoint;
  pulseUs = CENTER_US;
  holding = false;
  servo.writeMicroseconds(pulseUs);
  servo.attach(SERVO_PIN, 1000, 2000);
  servo.writeMicroseconds(pulseUs);
  digitalWrite(LED_BUILTIN, HIGH);
  running = true;
  lastStep = millis();
  if (endpointMode) Serial.println(F("TEST_START D2 NOMINAL_DEG=0..180 RANGE=1000..2000us NO_RETURN"));
  else if (angleMode) Serial.println(F("TEST_START D2 NOMINAL_DEG=0..120..0 RANGE=1000..1667us"));
  else Serial.println(wideMode ? F("TEST_START D2 CENTER=1500us RANGE=1000..2000us") : F("TEST_START D2 CENTER=1500us RANGE=1300..1700us"));
  if (endpointMode) Serial.println(F("MODE ENDPOINT180 SLOW ANGLES_UNCALIBRATED HOLD=1000ms"));
  else if (angleMode) Serial.println(F("MODE ANGLE120 SLOW ANGLES_UNCALIBRATED HOLD=1000ms"));
  else if (wideMode) Serial.println(F("MODE WIDE GRADUAL ANGLES_UNCALIBRATED HOLD=500ms"));
  else Serial.println(fastMode ? F("MODE FAST DIRECT_TARGETS HOLD=350ms") : F("MODE SLOW"));
}

void setup() {
  pinMode(SERVO_PIN, OUTPUT);
  digitalWrite(SERVO_PIN, LOW);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  Serial.println(F("READY UNO_MG995_D2 T=slow F=fast W=wide A=angle120 E=endpoint180 X=stop S=status SIGNAL_OFF"));
  Serial.println(F("AUTO_START IN 2000ms NOMINAL_DEG=0..180 ONCE_PER_RESET"));
  startupTime = millis();
}

void loop() {
  while (Serial.available()) {
    char command = Serial.read();
    if (command == 'T' || command == 't') beginTest(false);
    else if (command == 'F' || command == 'f') beginTest(true);
    else if (command == 'W' || command == 'w') beginTest(false, true);
    else if (command == 'A' || command == 'a') beginTest(false, false, true);
    else if (command == 'E' || command == 'e') beginTest(false, false, false, true);
    else if (command == 'X' || command == 'x') stopTest(false);
    else if (command == 'S' || command == 's') {
      Serial.println(running ? F("STATUS RUNNING") : F("STATUS IDLE SIGNAL_OFF"));
    }
  }
  if (autoStartPending && millis() - startupTime >= 2000UL) {
    beginTest(false, false, false, true);
  }
  if (!running) return;
  unsigned long now = millis();
  int target = endpointMode ? ENDPOINT_TARGETS_US[stage] : (angleMode ? ANGLE_TARGETS_US[stage] : (wideMode ? WIDE_TARGETS_US[stage] : TARGETS_US[stage]));
  if (fastMode && pulseUs != target) {
    pulseUs = target;
    servo.writeMicroseconds(pulseUs);
  } else if (pulseUs != target && now - lastStep >= 20) {
    lastStep = now;
    // Clamp the final step so targets not divisible by five are reached exactly.
    pulseUs = (target > pulseUs) ? min(pulseUs + 5, target) : max(pulseUs - 5, target);
    servo.writeMicroseconds(pulseUs);
  }
  if (pulseUs == target) {
    if (!holding) {
      holding = true;
      holdStarted = now;
      Serial.print(F("COMMAND_US="));
      Serial.println(pulseUs);
      if (angleMode || endpointMode) {
        Serial.print(F("COMMAND_NOMINAL_DEG="));
        Serial.println(stage == 1 ? (endpointMode ? 180 : 120) : 0);
      }
    } else if (now - holdStarted >= (wideMode ? 500UL : (fastMode ? 350UL : 1000UL))) {
      holding = false;
      if (++stage >= (endpointMode ? ENDPOINT_TARGET_COUNT : (angleMode ? ANGLE_TARGET_COUNT : (wideMode ? WIDE_TARGET_COUNT : TARGET_COUNT)))) stopTest(true);
    }
  }
}
