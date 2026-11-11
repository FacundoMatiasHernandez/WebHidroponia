param([ValidatePattern('^COM[0-9]+$')][string]$Port = 'COM13', [int]$BaudRate = 115200)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Ports
$serial = [System.IO.Ports.SerialPort]::new($Port, $BaudRate, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$serial.DtrEnable = $false
$serial.RtsEnable = $false
$serial.ReadTimeout = 500
try {
    $serial.Open()
    while ($true) {
        $text = $serial.ReadExisting()
        if ($text) { [Console]::Write($text); [Console]::Out.Flush() }
        Start-Sleep -Milliseconds 100
    }
} finally {
    if ($serial.IsOpen) { $serial.Close() }
    $serial.Dispose()
}
