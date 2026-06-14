Add-Type -AssemblyName System.Runtime.WindowsRuntime 2>$null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    return $asTask.Invoke($null, @($WinRtTask)).GetAwaiter().GetResult()
}

$mac = "f5f4294bc370"
$bytes = for ($i = 0; $i -lt $mac.Length; $i += 2) { [Convert]::ToByte($mac.Substring($i, 2), 16) }
[Array]::Reverse($bytes)
$blob = [Windows.Devices.Bluetooth.BluetoothAddress]::new([BitConverter]::ToUInt64($bytes, 0))

try {
    $device = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromBluetoothAddressAsync($blob)) ([Windows.Devices.Bluetooth.BluetoothDevice])
    Write-Host "Name: $($device.Name)"
    Write-Host "Connected: $($device.DeviceInformation.Pairing.IsPaired)"

    # Get RFCOMM services
    $rfcommServices = Await ($device.GetRfcommServicesAsync()) ($null)
    Write-Host "RFCOMM Services: $($rfcommServices.Services.Count)"
    $rfcommServices.Services | ForEach-Object {
        Write-Host "  ServiceId: $($_.ServiceId)"
        Write-Host "  ProtectionLevel: $($_.ProtectionLevel)"
        Write-Host "  MaxBufferSize: $($_.MaxBufferSize)"
        $sdp = $_.SdpRawAttributes
        $sdp.Keys | ForEach-Object {
            Write-Host "    SDP: $_"
        }
    }
} catch {
    Write-Host "Error: $_"
}
