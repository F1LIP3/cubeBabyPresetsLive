package com.cubebaby.presets.plugins;

import android.content.Context;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.util.HashMap;

@CapacitorPlugin(name = "Midi")
public class MidiPlugin extends Plugin {
    private MidiManager midiManager;
    private MidiDevice connectedDevice;
    private MidiInputPort inputPort;
    private MidiOutputPort outputPort;
    private MidiReceiver outputReceiver;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final HashMap<Integer, MidiDeviceInfo> deviceInfoMap = new HashMap<>();

    private final MidiManager.OnDeviceOpenedListener deviceOpenedListener = device -> {
        if (device == null) {
            notifyListeners("midiError", new JSObject().put("message", "Failed to open device"));
            return;
        }
        connectedDevice = device;
        MidiDeviceInfo info = device.getInfo();

        try {
            int inPorts = info.getInputPortCount();
            int outPorts = info.getOutputPortCount();

            if (inPorts > 0) {
                inputPort = device.openInputPort(0);
            }
            if (outPorts > 0) {
                outputPort = device.openOutputPort(0);
                if (outputPort != null) {
                    outputReceiver = new MidiReceiver() {
                        @Override
                        public void onSend(byte[] data, int offset, int count, long timestamp) {
                            byte[] msg = new byte[count];
                            System.arraycopy(data, offset, msg, 0, count);
                            JSObject ret = new JSObject();
                            JSArray arr = new JSArray();
                            for (byte b : msg) {
                                arr.put(b & 0xFF);
                            }
                            ret.put("data", arr);
                            notifyListeners("midiMessage", ret);
                        }
                    };
                    outputPort.connect(outputReceiver);
                }
            }

            String name = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME, "Unknown");
            notifyListeners("midiConnected", new JSObject().put("name", name).put("id", info.getId()));
        } catch (Exception e) {
            notifyListeners("midiError", new JSObject().put("message", e.getMessage()));
        }
    };

    @Override
    public void load() {
        super.load();
        midiManager = (MidiManager) getContext().getSystemService(Context.MIDI_SERVICE);
    }

    @PluginMethod
    public void listDevices(PluginCall call) {
        JSArray result = new JSArray();
        if (midiManager == null) {
            call.resolve(new JSObject().put("devices", result));
            return;
        }
        MidiDeviceInfo[] infos = midiManager.getDevices();
        deviceInfoMap.clear();
        for (MidiDeviceInfo info : infos) {
            int id = info.getId();
            String name = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME, "MIDI Device");
            JSObject deviceObj = new JSObject();
            deviceObj.put("id", id);
            deviceObj.put("name", name);
            deviceObj.put("inputPorts", info.getInputPortCount());
            deviceObj.put("outputPorts", info.getOutputPortCount());
            result.put(deviceObj);
            deviceInfoMap.put(id, info);
        }
        call.resolve(new JSObject().put("devices", result));
    }

    @PluginMethod
    public void connect(PluginCall call) {
        int deviceId = call.getInt("deviceId", -1);
        if (deviceId < 0 || !deviceInfoMap.containsKey(deviceId)) {
            call.reject("Invalid device ID");
            return;
        }
        midiManager.openDevice(deviceInfoMap.get(deviceId), deviceOpenedListener, mainHandler);
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeDevice();
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        JSArray dataArray = call.getArray("data");
        if (dataArray == null) {
            call.reject("No data provided");
            return;
        }
        try {
            byte[] data = new byte[dataArray.length()];
            for (int i = 0; i < dataArray.length(); i++) {
                data[i] = (byte) dataArray.getInt(i);
            }
            if (inputPort != null) {
                inputPort.send(data, 0, data.length);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Send failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        call.resolve(new JSObject().put("granted", true));
    }

    private void closeDevice() {
        try {
            if (outputPort != null && outputReceiver != null) {
                outputPort.disconnect(outputReceiver);
                outputReceiver = null;
                outputPort = null;
            }
            if (inputPort != null) {
                inputPort.close();
                inputPort = null;
            }
            if (connectedDevice != null) {
                connectedDevice.close();
                connectedDevice = null;
            }
        } catch (IOException ignored) {}
    }
}
