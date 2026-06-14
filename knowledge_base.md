# SINCO Cube Baby — Knowledge Base

## Device Overview

- **Product:** SINCO Cube Baby (multi-FX guitar pedal)
- **Reported name via SysEx:** `"SINCO-CubeBaby  "` (16 chars, null-padded)
- **SysEx Manufacturer ID:** `0x00 0x32` (Byte 2 of SysEx header)
- **Platform:** TI/ARM-based microcontroller with NOR flash at `0x834000`
- **Bluetooth Module:** Silicon Labs BT121 (dual-mode, BGAPI CONFIG firmware)
- **USB Interfaces:** Audio 1.0, MIDI, CardReader (mass storage)

## SysEx Protocol

All messages use the MIDI SysEx format with manufacturer ID `0x00 0x32`.

### Envelope Format

```
F0 <7-bit-encoded-payload> F7
```

The payload is 7-bit (septuplet) encoded. After decoding, the cleartext structure is:

```
[0x00, 0x59]  -- header/magic
[msgType]     -- 1 byte message type
[len (3)]     -- content length (LE, 3 bytes)
[content...]  -- content bytes
[checksum]    -- 1 byte = (~sum(all bytes from header onward)) & 0xFF
```

### Message Types

| Type | Hex | Direction | Description |
|------|-----|-----------|-------------|
| Init | `0x00` | C→D | Initialize connection. Content: empty |
| ACK | `0x00` | D→C | Acknowledge. Content: `[value]` where value=1=ack, 0=nak |
| RequestNameVersion | `0x11` | C→D | Request device identity. Content: empty |
| NameVersion | `0x11` | D→C | Device identity. Content: `[name(16)]` + `[mystery(11)]` |
| Erase | `0x21` | C→D | Erase memory sector. Content: `[cmd][addr(4)]` |
| WriteMemory | `0x22` | C→D | Write to memory. Content: `[cmd][addr(4)][len(3)][data...]` |
| ReadMemory | `0x23` | C→D | Read from memory. Content: `[cmd][addr(4)][len(3)]` |
| MemoryContent | `0x23` | D→C | Memory read response. Content: `[cmd][addr(4)][len(3)][data...]` |
| MysteryWrite | `0x24` | C→D | Register write. Content: `[0x04][reg][0x07][0x00][0x00][d0..d3]` (9 bytes) |

### Key Protocol Facts

1. **WriteMemory (msgType 0x22) with full 16-byte payload** — Works despite always returning `ACK:false`. Data IS written to the target address. Single-byte writes (len=1) are genuinely rejected (data NOT written).
2. **Erase (msgType 0x21)** — Always returns `ACK:false` but the erase DOES happen. Works for cmd=0 (IR ROM) and cmd=5 (settings).
3. **MysteryWrite (msgType 0x24, reg 0x60+paramIdx)** — ACK=true. Writes to DSP register space, not preset storage. Used for live parameter changes.
4. **Chunk size limit: 128 bytes** — Any WriteMemory with >128 bytes of payload causes SysEx buffer overflow (requires power cycle to recover).

## Memory Map

### Settings (cmd=5)

| Address | Size | Content |
|---------|------|---------|
| `0x0000` | 16 B | Preset A (active/live) |
| `0x0010` | 16 B | Preset B |
| `0x0020` | 16 B | Preset C |
| `0x80000000` | 16 B | Preset A (flash storage) |
| `0x80000010` | 16 B | Preset B (flash storage) |
| `0x80000020` | 16 B | Preset C (flash storage) |

**Preset switching:** Writes full 16-byte settings to `0x0000` with selector bits in byte 0 (bit 4-5 encode A/B/C).

### Firmware/DSP Memory (cmd=4)

| Address | Size | Content |
|---------|------|---------|
| `0x0000` | 4 B | `02 00 00 00` (DSP param header) |
| `0x1000` | 4 B | `67 0a 70 47` = ARM Thumb code |
| `0x0764` | 1 B | IR usable flag (value 2 observed, writes ineffective) |
| `0x0768` | 4 B | IR Distance (float32 LE, default 0.7000) |
| `0x076c` | 2048 B | IR Data RAM (512 × float32 samples) |

### IR ROM (cmd=0)

| Address | Size | Slot | Content |
|---------|------|------|---------|
| `0x00068000` | 4096 B | 0 | Factory cabinet 0 |
| `0x00069000` | 4096 B | 1 | Factory cabinet 1 |
| `0x0006A000` | 4096 B | 2 | Factory cabinet 2 |
| ... | 4096 B | ... | ... |
| `0x0006F000` | 4096 B | 7 | User-writable slot (cabinet 8 on pedal) |
| `0x00070000` | 4096 B | 8 | Upload target (also accessible) |

Total IR ROM: 32 KB (from 0x00069000 to 0x00071000). The backup script additionally reads from 0x68000-0x68FFF.

### Preset Data Format (13 parameters in 16 bytes)

| Offset | Field | Range | Bytes |
|--------|-------|-------|-------|
| 0 | Type | 0–8 | 1 |
| 1 | Gain | 0–7 | 1 |
| 2 | Tone | 0–15 | 1 |
| 3 | Reverb | 0–15 | 1 |
| 4 | Feedback | 0–127 | 1 |
| 5 | Volume | 0–127 | 1 |
| 6 | Time | 0–31 | 1 |
| 7 | Mix | 0–118 | 1 |
| 8 | Modulation | 0–15 | 1 |
| 9 | Cabinet | 0–8 | 1 |
| 10 | IRSection | 0/1 | 1 |
| 11 | DelaySection | 0/1 | 1 |
| 12 | ToneSection | 0/1 | 1 |
| 13–15 | (padding) | — | 3 |

### MysteryWrite Register Map (msgType 0x24)

Content structure: `[0x04, reg, 0x07, 0x00, 0x00, d0, d1, d2, d3]`

All registers 0x05–0x7F return ACK=true. The 13 parameters map to registers 0x60+paramIdx. Writes to these registers do NOT modify preset memory at 0x0000 — they target DSP control registers directly (real-time parameter changes).

## IR Cabinet Data

### Cabinet ROM Format (4096 bytes per slot)

| Offset | Size | Content |
|--------|------|---------|
| 0–3 | 4 B | Flag: `0x01 0x00 0x00 0x00` (presence marker) |
| 4–7 | 4 B | Volume: float32 LE (default ~0.7) |
| 8–4095 | 4088 B | Audio: 1022 × float32 samples |

The audio occupies bytes 8–4095, giving 1022 samples per 4096-byte cabinet. When uploading, 512 IR samples are copied to positions 0–511 (bytes 8–2055) and the rest is zero-padded.

### Key Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `IR_ROM_SLOT_SIZE` | 4096 | Physical ROM sector stride |
| `IR_ROM_SAMPLES` | 1024 | Float32 samples per ROM slot |
| `IR_SLOT_SIZE` | 2048 | RAM slot (512 samples × 4 bytes) |
| `IR_SAMPLES` | 512 | Float32 samples in RAM/uploaded IR |
| `IR_WRITE_CHUNK_SIZE` | 128 | Max bytes per SysEx write message |
| `TARGET_SAMPLE_RATE` | 48000 | IR sample rate |
| `IR_DATA_ROM_ADDR` | `0x00069000` | First IR ROM slot address |

### CRITICAL FIX: Frame Stride is 4096, not 2048

The original code assumed a 2048-byte stride (512 samples) per cabinet. The physical ROM sectors are 4096 bytes (1024 samples). Writing only 2048 bytes left the second half as `0xFF` (NaN float32 → audio silence). The Erase+Write sequence would erase 4096 bytes but only write 2048, corrupting the cabinet.

**Fix:** Added `IR_ROM_SLOT_SIZE = 4096` and `IR_ROM_SAMPLES = 1024` constants. ROM address calculation: `0x00069000 + slot * IR_ROM_SLOT_SIZE`.

### Cab Header at Bytes 0–7

Bytes 0–3: `01 00 00 00` (flag byte + 3 zero padding)
Bytes 4–7: float32 volume (0.66–0.76 for factory cabinets)

The `padIrToRomBytes()` function in `irProcessor.ts` produces this format:
```
01 00 00 00 <volume_float32_le> <1022 x float32_audio>
```

### Upload Flow (Verified Working)

**To ROM (persistent, survives power cycle):**
1. Pad 512 IR samples to 4096-byte cabinet buffer via `padIrToRomBytes()`
2. Erase target sector (cmd=0, msgType 0x21) at `0x00069000 + slot * 4096`
3. Wait 500ms
4. Write 4096 bytes in 32 × 128-byte chunks (cmd=0, WriteMemory)
5. 100ms delay between chunks
6. Verify by reading back and comparing first float32

**To RAM (immediate, volatile):**
1. Set IR section ON in preset (`IRSection=1`)
2. Write 2048 bytes in 16 × 128-byte chunks (cmd=4, addr=0x076c)
3. IR is immediately active

## Bluetooth Investigation

### BT121 Module
- **Module:** Silicon Labs BT121 (dual-mode Bluetooth)
- **Firmware format:** BGAPI CONFIG / BGLIB format (not main MCU code)
- **SPI pins:** PB5–PB8 (per `confile.inf`)
- **Manufacturing:** Wurth Elektronik

### .up Firmware Structure
- Magic: `CONFIG\0` at offset 0x00
- Header at offset 0x07: version=1, count=9, data at offset 0xACDE
- Entry table at 0x20: 8 entries of 256 bytes
- Flash target: `0x834000` (TI ARM internal flash)
- Boot signature at 0xFC: `55 AA`
- Firmware data starts at offset 0x100

### SPP Status
- **SPP UUID (0x1101)** and **`SL_SPP`** name **exist** in SDP records at file offsets 0x10f60–0x10fa5
- SPP is on **RFCOMM channel 3**
- Service config table at 0x10de0 uses identifiers: `'A'` (A2DP), `'S'` (SPP), `'N'` (inactive/disabled)
- **SPP is defined but NOT started** — no BGAPI `start_service` command is sent for SPP; only A2DP and AVRCP are activated
- SDP area is identical across all firmware variants (A/B/C) and versions (May vs July 2022)
- Pedal MAC `f5:f4:29:4b:c3:70` connects as audio device only

**Conclusion:** SPP activation requires binary firmware patching. No BGAPI passthrough exists in the SysEx protocol.

## Android APK Build

### Architecture
- **Wrapper:** Capacitor 8 wraps the existing Vite+React web app
- **App ID:** `com.cubebaby.presets`
- **Web Dir:** `dist/renderer` (shared with Electron build)
- **Native MIDI Plugin:** Written in Java using `android.media.midi.MidiManager`

### MIDI Service Abstraction

Three-layer architecture in `src/midi/`:

| File | Class | Platform |
|------|-------|----------|
| `midiService.ts` | `MidiService` interface | Abstraction |
| `webMidiService.ts` | `WebMidiService` | Browser/Electron (Web MIDI API) |
| `capacitorMidiService.ts` | `CapacitorMidiService` | Android native (Capacitor plugin) |

Auto-detection in `cubeBabyMidi.ts`:
```typescript
function createMidiService(): MidiService {
  if (typeof Capacitor !== 'undefined' && Capacitor.isNative) {
    return new CapacitorMidiService();
  }
  return new WebMidiService();
}
```

### Native MIDI Plugin (`MidiPlugin.java`)
- Uses `MidiManager.getDevices()` to enumerate USB MIDI devices
- **TX:** `MidiInputPort.send()` (Android's MidiInputPort sends TO the device)
- **RX:** `MidiOutputPort.connect(MidiReceiver)` (Android's MidiOutputPort receives FROM the device)
- Emits `"midiMessage"` events to JavaScript with received byte arrays
- Plugin methods: `listDevices`, `connect`, `disconnect`, `send`, `requestPermission`

### Build
- **Java:** JDK 21 (required for Capacitor 8; Java 17 gives "invalid source release: 21")
- **Gradle:** `./gradlew assembleDebug`
- **Output:** `android/app/build/outputs/apk/debug/app-debug.apk`
- **USB:** `android.hardware.usb.host` required (app won't install on devices without USB Host)

### Caveats
- Web MIDI API is unavailable in Android WebView
- Requires physical USB OTG + USB-MIDI adapter connected to Cube Baby
- The deprecated API warning in `MidiPlugin.java` is harmless

## File Structure

```
cubeBabyPresetsLive/
├── src/
│   ├── main/               # Electron main process
│   │   ├── main.ts
│   │   └── preload.ts
│   ├── midi/               # MIDI service abstraction
│   │   ├── cubeBabyMidi.ts # Device communication logic
│   │   ├── midiService.ts  # Interface
│   │   ├── webMidiService.ts
│   │   └── capacitorMidiService.ts
│   ├── plugins/
│   │   └── midi.ts         # Capacitor plugin TypeScript bindings
│   ├── protocol/
│   │   ├── types.ts        # Constants, parameter definitions
│   │   ├── encode.ts       # SysEx 7-bit encoding
│   │   ├── parser.ts       # SysEx parsing
│   │   └── index.ts        # Message builders
│   ├── renderer/
│   │   ├── App.tsx         # Main React app
│   │   ├── irProcessor.ts  # WAV processing, ROM padding
│   │   ├── components/
│   │   │   ├── Knob.tsx
│   │   │   ├── Pedal.tsx
│   │   │   └── Slider.tsx
│   │   └── index.tsx
│   └── types/
│       └── globals.d.ts
├── android/
│   ├── app/
│   │   └── src/main/java/com/cubebaby/presets/
│   │       ├── MainActivity.java
│   │       └── plugins/MidiPlugin.java
│   └── build.gradle
├── scripts/
│   ├── backup_cabinets.js       # Backup all 8 factory cabinets
│   ├── upload_test_ir.js        # Upload custom IR to cabinet 8
│   ├── restore_ir.js            # Restore factory IR from backup
│   ├── scan_ir_slots.js         # Scan all IR ROM slots
│   ├── scan_cabinets.ts         # Scan preset memory
│   ├── scan_cabinet_headers.js  # Read cabinet headers
│   ├── scan_full_cabinets.js    # Full cabinet byte dump
│   └── test_init.js             # Basic connectivity test
├── backup/
│   └── cabinet_N_0xXXXX.bin     # 8 factory cabinet dumps (4096 B each)
├── capacitor.config.ts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Known Working Operations

### Verified
- ✅ Init → ACK:true
- ✅ RequestNameVersion → NameVersion with device name
- ✅ ReadMemory cmd=5, addresses 0x0000, 0x0010, 0x0020 → preset data
- ✅ ReadMemory cmd=4 → DSP/firmware memory
- ✅ ReadMemory cmd=0 → IR ROM cabinets
- ✅ WriteMemory cmd=5, full 16-byte writes at 0x0000/0x0010/0x0020 → presets saved (ACK:false is misleading)
- ✅ WriteMemory cmd=5, full 16-byte writes at 0x80000000+offset → flash storage
- ✅ WriteMemory cmd=0, IR ROM writes (128-byte chunks, 4096 total) → custom IR uploaded
- ✅ MysteryWrite reg 0x60–0x70 → ACK:true (DSP live parameter changes)
- ✅ Erase cmd=0 at ROM sector → IR slot erased (ACK:false, but works)
- ✅ Upload custom WAV → cabinet verified by reading back
- ✅ All 8 factory cabinets backed up to `backup/`
- ✅ APK build via Capacitor (assembleDebug succeeds)

### Fails
- ❌ WriteMemory with len > 128 → SysEx buffer overflow (power cycle needed)
- ❌ Single-byte WriteMemory (len=1) → data NOT written
- ❌ Erase cmd=5 → ACK:false (but may still work)
- ❌ ReadMemory cmd=5 at 0x08000000+ → all zeros (firmware not accessible via preset cmd)
- ❌ MysteryWrite changes to preset memory at 0x0000 (affects DSP only)
- ❌ Firmware dump not possible via SysEx
- ❌ IR usable flag write (0x764) — value stays at 2

## Fixed Bugs

### IR Cabinet Silence (2026-06-13)
- **Root cause:** Cabinet stride was 2048 bytes (512 samples) per the original protocol code, but physical ROM sectors are 4096 bytes (1024 samples). Erase+Write only wrote 2048 bytes, leaving the second half as 0xFF (NaN float32) → silence.
- **Fix:** Added `IR_ROM_SLOT_SIZE = 4096`, `IR_ROM_SAMPLES = 1024` constants. Updated all ROM address calculations and `padIrToRomBytes()` to produce 4096-byte cabinets with a 8-byte header + 1022 samples.

### Knob Change Flood (2026-06-13)
- **Root cause:** `handleKnobChangeEnd` was writing the full preset to flash on every knob drag end, causing SysEx flood and pedal reboot.
- **Fix:** `handleKnobChangeEnd` now calls `writeSingleKnob(name, value)` only — a single MysteryWrite (msgType 0x24) for the changed parameter.

## Open Questions

1. **What controls which ROM IR slot is loaded into RAM?** The pedal seems to always load from RAM at 0x076c. The Cabinet parameter (0-8 in the preset) might select which ROM slot is auto-copied to RAM at boot.

2. **Are there more IR slots beyond 0x00070FFF?** The backup script reads from 0x68000-0x6FFFF (9 slots?), but the app uses 0x69000-0x70FFF (8 slots). The user upload worked at slot 8 → 0x70000.

3. **Can SPP be activated via firmware patch?** The BT121 module has SPP in its SDP table but it's not started. Binary patching the BGAPI CONFIG could enable it.

4. **What does the 0x07 constant in MysteryWrite mean?** Could be length, mode, or sub-command identifier.
