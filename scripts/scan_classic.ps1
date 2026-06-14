Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class BluetoothDiscovery
{
    [DllImport("bluetoothapis.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern int BluetoothFindFirstRadio(ref BLUETOOTH_FIND_RADIO_PARAMS pbtfrp, out IntPtr phRadio);

    [DllImport("bluetoothapis.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool BluetoothFindNextRadio(IntPtr hFind, out IntPtr phRadio);

    [DllImport("bluetoothapis.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool BluetoothFindRadioClose(IntPtr hFind);

    [DllImport("bluetoothapis.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern int BluetoothFindDeviceClose(IntPtr hFind);

    [DllImport("bluetoothapis.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern int BluetoothFindFirstDevice(ref BLUETOOTH_DEVICE_SEARCH_PARAMS pbtsp, out BLUETOOTH_DEVICE_INFO pbtdi);

    [DllImport("bluetoothapis.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool BluetoothFindNextDevice(IntPtr hFind, ref BLUETOOTH_DEVICE_INFO pbtdi);

    [StructLayout(LayoutKind.Sequential)]
    private struct BLUETOOTH_FIND_RADIO_PARAMS
    {
        public uint dwSize;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct BLUETOOTH_DEVICE_INFO
    {
        public uint dwSize;
        public ulong Address;
        public uint ulClassofDevice;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fConnected;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fRemembered;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fAuthenticated;
        public System.Runtime.InteropServices.ComTypes.FILETIME stLastSeen;
        public System.Runtime.InteropServices.ComTypes.FILETIME stLastUsed;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)]
        public string szName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BLUETOOTH_DEVICE_SEARCH_PARAMS
    {
        public uint dwSize;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fReturnAuthenticated;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fReturnRemembered;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fReturnConnected;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fReturnUnknown;
        [MarshalAs(UnmanagedType.Bool)]
        public bool fIssueInquiry;
        public byte cTimeoutMultiplier;
        public IntPtr hRadio;
    }

    public static void ListPairedDevices()
    {
        var findParams = new BLUETOOTH_FIND_RADIO_PARAMS();
        findParams.dwSize = (uint)Marshal.SizeOf(typeof(BLUETOOTH_FIND_RADIO_PARAMS));

        IntPtr hRadio;
        int result = BluetoothFindFirstRadio(ref findParams, out hRadio);
        if (result != 0)
        {
            Console.WriteLine("Found Bluetooth radio");
        }

        var searchParams = new BLUETOOTH_DEVICE_SEARCH_PARAMS();
        searchParams.dwSize = (uint)Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_SEARCH_PARAMS));
        searchParams.fReturnAuthenticated = true;
        searchParams.fReturnRemembered = true;
        searchParams.fReturnConnected = true;
        searchParams.fReturnUnknown = true;
        searchParams.fIssueInquiry = true;
        searchParams.cTimeoutMultiplier = 10; // ~10 seconds
        searchParams.hRadio = IntPtr.Zero;

        var deviceInfo = new BLUETOOTH_DEVICE_INFO();
        deviceInfo.dwSize = (uint)Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_INFO));

        Console.WriteLine("Scanning for Bluetooth Classic devices (10 seconds)...");
        int firstResult = BluetoothFindFirstDevice(ref searchParams, out deviceInfo);
        
        if (firstResult == 0)
        {
            Console.WriteLine("No Classic Bluetooth devices found.");
            return;
        }

        Console.WriteLine("Found devices:");
        Console.WriteLine("  Name: " + deviceInfo.szName);
        Console.WriteLine("  Address: " + deviceInfo.Address.ToString("X12"));
        Console.WriteLine("  Connected: " + deviceInfo.fConnected);
        Console.WriteLine("  Remembered: " + deviceInfo.fRemembered);
        Console.WriteLine("  Authenticated: " + deviceInfo.fAuthenticated);

        IntPtr hFind = (IntPtr)firstResult;
        while (BluetoothFindNextDevice(hFind, ref deviceInfo))
        {
            Console.WriteLine("---");
            Console.WriteLine("  Name: " + deviceInfo.szName);
            Console.WriteLine("  Address: " + deviceInfo.Address.ToString("X12"));
            Console.WriteLine("  Connected: " + deviceInfo.fConnected);
            Console.WriteLine("  Remembered: " + deviceInfo.fRemembered);
            Console.WriteLine("  Authenticated: " + deviceInfo.fAuthenticated);
        }

        BluetoothFindDeviceClose(hFind);
    }
}
"@

[BluetoothDiscovery]::ListPairedDevices()
