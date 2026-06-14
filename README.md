# Cube Baby Presets Live

**A cross-platform editor for the SINCO / Cuvave Cube Baby multi-FX guitar pedal.**

Control every parameter, switch presets, and upload custom impulse response cabinets — all from your desktop or Android device.

![Electron](https://img.shields.io/badge/Electron-33-blue?logo=electron) ![React](https://img.shields.io/badge/React-18-61DAFB?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript) ![Capacitor](https://img.shields.io/badge/Capacitor-8-119EFF?logo=capacitor) ![Android](https://img.shields.io/badge/Android-34-3DDC84?logo=android)

---

## Features

### Preset Control

| | |
|---|---|
| **Read presets** | Live-read all 3 pedal preset slots (A/B/C) over MIDI SysEx |
| **Edit parameters** | Drive type/gain, tone, modulation, delay (time/fb/mix), reverb, cabinet select, volume |
| **Toggle sections** | Enable/disable IR, Delay, and Tone sections independently |
| **Write to pedal** | Save edits to any slot — writes survive power cycles |
| **Switch presets** | Instant preset switching with LED indicator sync |

### Custom IR Upload

| | |
|---|---|
| **WAV → IR** | Load any WAV file, auto-resampled to 48 kHz, normalized, trimmed to 512 samples |
| **RAM preview** | Write to IR RAM (cmd=4) for instant audition — no flash wear |
| **ROM storage** | Erase + write to any of 9 persistent cabinet slots (4096-byte ROM format) |
| **Cabinet header** | Automatic flag + volume float32 header on every upload |
| **Backup / Restore** | Dump factory cabinets and restore them from local backup files |

### Platform Support

| Platform | MIDI Backend | Status |
|---|---|---|
| **Desktop (Electron)** | Web MIDI API (`navigator.requestMIDIAccess`) | ✅ |
| **Android** | Native USB-MIDI via `android.media.midi` (Capacitor plugin) | ✅ |
| **Web browser** | Web MIDI API (Chrome/Edge w/ SysEx enabled) | ✅ |

---

## Quick Start

### Desktop (Electron)

```bash
npm install
npm run build
npm start
```

For development with hot-reload:

```bash
npm run dev
```

### Android APK

```bash
# Prerequisites: JDK 21, Android SDK, USB OTG cable + USB-MIDI adapter
npm install
npm run build
npx cap sync
cd android
./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

> **Note:** The APK requires `android.hardware.usb.host` — only devices with USB OTG support can install it.

---

## UI Overview

![UI Layout](https://via.placeholder.com/800x500?text=Cube+Baby+Presets+Live+Editor)

The editor is split into clear sections:

```
┌─────────────────────────────────────────────┐
│  🟡 A    🟢 B    🔵 C       [Connect]      │  ← Preset selector + connection
├─────────────────────────────────────────────┤
│  TYPE    GAIN    TONE     MOD               │
│  [0–8]   [0–7]   [0–15]  [0–15]            │  ← Drive & modulation
├─────────────────────────────────────────────┤
│  TIME    FB      MIX     REVERB            │
│  [0–31]  [0–127] [0–118] [0–15]            │  ← Delay & reverb
├─────────────────────────────────────────────┤
│  IR CAB  VOLUME                             │
│  [0–8]   [0–127]                            │  ← Cabinet & level
├─────────────────────────────────────────────┤
│  🟢 IR Section  🟢 Delay  🟢 Tone          │  ← Section toggles
├─────────────────────────────────────────────┤
│  Upload IR  [Choose WAV]  [Slot ▼]  [Go]   │  ← IR uploader
└─────────────────────────────────────────────┘
```

---

## Protocol

The pedal communicates over MIDI SysEx with manufacturer ID `0x00 0x32`. Key facts:

- **Read presets:** `ReadMemory` cmd=5 at `0x0000` (A), `0x0010` (B), `0x0020` (C) — 16 bytes each
- **Write presets:** `WriteMemory` cmd=5 with full 16-byte payload — **works despite ACK:false**
- **Live DSP:** `MysteryWrite` (msgType 0x24, reg `0x60+paramIdx`) — instant knob response
- **IR RAM:** `WriteMemory` cmd=4 at `0x076c` — 2048 bytes (512 float32 samples)
- **IR ROM:** `WriteMemory` cmd=0 at `0x00069000 + slot×4096` — 4096 bytes per cabinet
- **Max chunk:** 128 bytes per write — larger payloads overflow the buffer

All protocol details are documented in [`knowledge_base.md`](knowledge_base.md).

---

## Project Structure

```
cubeBabyPresetsLive/
├── src/
│   ├── renderer/           # React UI (Vite)
│   │   ├── App.tsx         # Main application component
│   │   ├── irProcessor.ts  # WAV decoding, resampling, ROM padding
│   │   └── components/     # Knob, Pedal, Slider components
│   ├── protocol/           # SysEx protocol layer
│   │   ├── types.ts        # Constants, parameter definitions
│   │   ├── encode.ts       # 7-bit (septuplet) encoding
│   │   ├── parser.ts       # SysEx response parsing
│   │   └── index.ts        # Message builders + re-exports
│   ├── midi/               # MIDI service abstraction
│   │   ├── midiService.ts         # MidiService interface
│   │   ├── webMidiService.ts      # Browser/Electron backend
│   │   ├── capacitorMidiService.ts # Android native backend
│   │   └── cubeBabyMidi.ts        # Device communication logic
│   ├── plugins/
│   │   └── midi.ts         # Capacitor plugin TypeScript bindings
│   ├── main/               # Electron main process
│   └── types/
├── android/                # Capacitor Android project
│   └── app/src/main/java/com/cubebaby/presets/plugins/
│       └── MidiPlugin.java # Native USB-MIDI plugin
├── scripts/                # Standalone Node.js utility scripts
│   ├── backup_cabinets.js  # Backup all 8 factory cabinets
│   ├── upload_test_ir.js   # Upload a WAV as IR cabinet
│   └── ...
├── knowledge_base.md       # Full protocol and hardware documentation
├── capacitor.config.ts     # Capacitor configuration
├── package.json
└── vite.config.ts
```

---

## Scripts

Standalone Node.js scripts (using `node-midi`) for headless operations:

| Script | Purpose |
|---|---|
| `scripts/backup_cabinets.js` | Dump all 8 factory cabinets to `backup/` |
| `scripts/upload_test_ir.js` | Upload a WAV file to an IR ROM slot |
| `scripts/restore_ir.js` | Restore a cabinet from backup |
| `scripts/scan_cabinets.ts` | Probe preset memory map |
| `scripts/scan_ir_slots.js` | Scan all IR ROM slots |
| `scripts/test_init.js` | Basic connectivity test |

---

## Technical Details

### IR Cabinet ROM Format

Every cabinet in ROM is exactly **4096 bytes**:

```
Offset  Size  Content
─────────────────────────────
0x000   4 B   0x01 0x00 0x00 0x00  (presence flag)
0x004   4 B   float32 LE volume     (default ~0.7)
0x008   4088 B  1022 × float32 audio samples
```

### Preset Data Layout

Each preset is 16 bytes in memory, with 13 one-byte parameters:

```
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────────────┐
│ Ty │ Gn │ Tn │ Rv │ Fb │ Vl │ Tm │ Mx │ Md │ Ca │ IR │ D  │ T  │ (padding) │
│ pe │ ai │ on │ er │ ee │ ol │ im │ ix │ od │ bi │ Se │ Se │ Se │           │
│    │ n  │ e  │ b  │ db │ um │ e  │    │ ul │ ne │ ct │ ct │ ct │           │
│ 0  │ 1  │ 2  │ 3  │ 4  │ 5  │ 6  │ 7  │ 8  │ 9  │ 10 │ 11 │ 12 │  13–15   │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────────────┘
```

---

## Building from Source

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **JDK 21** (for Android — Java 17 gives "invalid source release: 21")
- **Android SDK** (for Android)
- **USB OTG cable + USB-MIDI adapter** (for Android deployment)

### Commands

```bash
# Install dependencies
npm install

# Build desktop app
npm run build

# Sync web assets to Android
npx cap sync

# Build Android debug APK
cd android
./gradlew assembleDebug
```

---

## Related Work

This project builds on reverse-engineering work originally done by [pferreir/cuvave-midi](https://github.com/pferreir/cuvave-midi). The SysEx protocol structure (7-bit encoding, memory map, cmd=4 vs cmd=5) was informed by that research.

---

## License

MIT
