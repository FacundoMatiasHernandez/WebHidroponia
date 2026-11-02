param([string]$Port = 'COM11', [switch]$Fast, [switch]$Wide, [switch]$Angle120, [switch]$Endpoint180)
$ErrorActionPreference = 'Stop'
if (([int]$Fast.IsPresent + [int]$Wide.IsPresent + [int]$Angle120.IsPresent + [int]$Endpoint180.IsPresent) -gt 1) { throw 'Elegir un solo modo: Fast, Wide, Angle120 o Endpoint180.' }
$serial = [System.IO.Ports.SerialPort]::new($Port, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$serial.DtrEnable = $true
$serial.ReadTimeout = 500
$serial.WriteTimeout = 1000
$log = [System.Text.StringBuilder]::new()
$logPath = Join-Path $PSScriptRoot $(if ($Endpoint180) { 'serial_endpoint180_test.log' } elseif ($Angle120) { 'serial_angle120_test.log' } elseif ($Wide) { 'serial_wide_test.log' } elseif ($Fast) { 'serial_fast_test.log' } else { 'serial_test.log' })
try {
    $serial.Open()
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $readyDeadline) {
        $chunk = $serial.ReadExisting()
        if ($chunk) {
            [void]$log.Append($chunk)
            Write-Host -NoNewline $chunk
        }
        if ($log.ToString().Contains('READY UNO_MG995_D2')) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $log.ToString().Contains('READY UNO_MG995_D2')) {
        throw 'El Arduino no confirmo el firmware de prueba; no se inicia movimiento.'
    }
    if ($Angle120 -and -not $log.ToString().Contains('A=angle120')) {
        throw 'El firmware conectado no admite el modo Angle120.'
    }
    if ($Endpoint180 -and -not $log.ToString().Contains('E=endpoint180')) {
        throw 'El firmware conectado no admite el modo Endpoint180.'
    }
    $serial.Write($(if ($Endpoint180) { 'E' } elseif ($Angle120) { 'A' } elseif ($Wide) { 'W' } elseif ($Fast) { 'F' } else { 'T' }))
    $testDeadline = [DateTime]::UtcNow.AddSeconds(25)
    while ([DateTime]::UtcNow -lt $testDeadline) {
        $chunk = $serial.ReadExisting()
        if ($chunk) {
            [void]$log.Append($chunk)
            Write-Host -NoNewline $chunk
        }
        if ($log.ToString().Contains('TEST_DONE SIGNAL_OFF')) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $log.ToString().Contains('TEST_DONE SIGNAL_OFF')) {
        throw 'No llego la confirmacion de fin de prueba.'
    }
    $serial.Write('S')
    Start-Sleep -Milliseconds 300
    $chunk = $serial.ReadExisting()
    [void]$log.Append($chunk)
    Write-Host -NoNewline $chunk
    if (-not $log.ToString().Contains('STATUS IDLE SIGNAL_OFF')) {
        throw 'No se pudo confirmar la senal apagada.'
    }
} finally {
    if ($serial.IsOpen) {
        $serial.Write('X')
        $serial.Close()
    }
    $serial.Dispose()
    [System.IO.File]::WriteAllText($logPath, $log.ToString())
}
