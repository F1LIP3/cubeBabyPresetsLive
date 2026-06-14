// Upload test IR: reads a WAV file, processes to 512 samples, pads to 4096 bytes, writes to ROM slot 7 (cabinet 8 = ir_cab=8)
var midi = require('midi');
var fs = require('fs');
var path = require('path');
var HEADER = [0x00, 0x59];

function calcChecksum(data) {
    var s = 0;
    for (var i = 0; i < data.length; i++) s = (s + data[i]) & 0xff;
    return (~s) & 0xff;
}
function encode(source) {
    var dest = [], bitNum = 0, accum = 0;
    for (var i = 0; i < source.length; i++) {
        accum = (accum | (source[i] << (bitNum & 0x1f))) >>> 0;
        bitNum += 1;
        while (true) {
            dest.push(accum & 0x7f);
            accum = (accum >>> 7) >>> 0;
            if (bitNum < 7) break;
            bitNum -= 7;
        }
    }
    dest.push(accum & 0x7f);
    return dest;
}
function decode(source) {
    var dest = [], bitNum = 0, lastVal = 0;
    for (var i = 0; i < source.length; i++) {
        var b = source[i];
        var mask = (0xFFFFFFFF >>> (32 - bitNum)) >>> 0;
        var accum = b & mask;
        if (bitNum > 0) dest.push((lastVal & 0x7f) | (accum << (8 - bitNum)));
        lastVal = b >>> bitNum;
        bitNum = (bitNum + 1) % 8;
    }
    if (lastVal > 0) dest.push(lastVal);
    return dest;
}
function buildSysex(msgType, content) {
    var lenBytes = [content.length & 0xff, (content.length >> 8) & 0xff, (content.length >> 16) & 0xff];
    var cleartext = [].concat(HEADER, [msgType], lenBytes, content);
    var chk = calcChecksum(cleartext.slice(6));
    cleartext.push(chk);
    return [0xf0].concat(encode(cleartext)).concat([0xf7]);
}
var input = new midi.Input();
var output = new midi.Output();
input.ignoreTypes(false, false, false);
input.openPort(0);
output.openPort(1);
var pending = null;
input.on('message', function(dt, msg) {
    if (pending) {
        clearTimeout(pending.timer);
        var r = pending.resolve;
        pending = null;
        r(msg);
    }
});
function sendAndWait(msgType, payload) {
    return new Promise(function(resolve, reject) {
        var sysex = msgType === 0 ? buildSysex(0x00, []) : buildSysex(msgType, payload);
        var timer = setTimeout(function() {
            if (pending) { pending = null; reject(new Error('Timeout')); }
        }, 10000);
        pending = { resolve: resolve, timer: timer };
        output.send(sysex);
    });
}
async function readMemory(addr, totalLen) {
    var result = [];
    var CHUNK = 128;
    for (var off = 0; off < totalLen; ) {
        var chunkLen = Math.min(CHUNK, totalLen - off);
        var a = addr + off;
        var pl = [0, a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff,
                    chunkLen & 0xff, (chunkLen >> 8) & 0xff, (chunkLen >> 16) & 0xff];
        var resp = await sendAndWait(0x23, pl);
        var dec = decode(Array.from(resp).slice(1, -1));
        var dl = dec[11] | (dec[12] << 8) | (dec[13] << 16);
        for (var j = 0; j < dl && off + j < totalLen; j++) result.push(dec[14 + j]);
        off += chunkLen;
        await new Promise(function(r) { setTimeout(r, 100); });
    }
    return new Uint8Array(result);
}
function hexStr(b, n) {
    var s = '';
    for (var i = 0; i < Math.min(b.length, n); i++) s += b[i].toString(16).padStart(2, '0') + ' ';
    return s.trim();
}
function f32Str(b, n) {
    var f = new Float32Array(b.slice(0, n * 4).buffer);
    return '[' + Array.from(f).map(function(v) { return v.toFixed(6); }).join(', ') + ']';
}

// Simple WAV reader for float32 mono PCM
function readWavAsFloat32(filePath) {
    var buf = fs.readFileSync(filePath);
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var sampleRate = dv.getUint32(24, true);
    var bitsPerSample = dv.getUint16(34, true);
    var numChannels = dv.getUint16(22, true);
    var dataSize = dv.getUint32(40, true);
    var dataStart = 44; // simple WAV header
    var numSamples = dataSize / (bitsPerSample / 8) / numChannels;
    console.log('WAV: ' + path.basename(filePath) + ' ' + sampleRate + 'Hz ' + bitsPerSample + 'bit ' + numChannels + 'ch ' + numSamples + ' samples');
    var mono = new Float32Array(numSamples);
    for (var i = 0; i < numSamples; i++) {
        var sample = 0;
        if (bitsPerSample === 32) {
            for (var ch = 0; ch < numChannels; ch++) {
                sample += dv.getFloat32(dataStart + (i * numChannels + ch) * 4, true);
            }
        } else if (bitsPerSample === 24) {
            for (var ch = 0; ch < numChannels; ch++) {
                var off = dataStart + (i * numChannels + ch) * 3;
                var val = dv.getUint8(off) | (dv.getUint8(off + 1) << 8) | (dv.getInt8(off + 2) << 16);
                sample += val / 8388608;
            }
        } else if (bitsPerSample === 16) {
            for (var ch = 0; ch < numChannels; ch++) {
                sample += dv.getInt16(dataStart + (i * numChannels + ch) * 2, true) / 32768;
            }
        }
        mono[i] = sample / numChannels;
    }
    return { data: mono, sampleRate: sampleRate };
}

// Resample (linear interpolation)
function resample(src, srcRate, dstRate) {
    if (srcRate === dstRate) return src;
    var ratio = dstRate / srcRate;
    var dst = new Float32Array(Math.round(src.length * ratio));
    for (var i = 0; i < dst.length; i++) {
        var pos = i / ratio;
        var lo = Math.floor(pos);
        var hi = Math.min(lo + 1, src.length - 1);
        var frac = pos - lo;
        dst[i] = src[lo] + (src[hi] - src[lo]) * frac;
    }
    return dst;
}

(async function() {
    try {
        await sendAndWait(0, []);
        console.log('Init OK\n');

        var wavPath = path.join(__dirname, '..', '8 - Catharsis s-preshigh.wav');
        if (!fs.existsSync(wavPath)) {
            console.error('WAV not found:', wavPath);
            input.closePort(); output.closePort();
            return;
        }

        // 1. Process WAV to 512 samples
        console.log('=== PROCESSING WAV ===');
        var wav = readWavAsFloat32(wavPath);
        var resampled = resample(wav.data, wav.sampleRate, 48000);
        var ir512 = new Float32Array(512);
        var copyLen = Math.min(resampled.length, 512);
        ir512.set(resampled.subarray ? resampled.subarray(0, copyLen) : resampled.slice(0, copyLen));
        // Normalize
        var peak = 0;
        for (var i = 0; i < ir512.length; i++) { var abs = Math.abs(ir512[i]); if (abs > peak) peak = abs; }
        if (peak > 0) for (var i = 0; i < ir512.length; i++) ir512[i] /= peak;
        console.log('IR: ' + ir512.length + ' samples, peak=' + peak.toFixed(4));
        console.log('First 8: ' + f32Str(new Uint8Array(ir512.buffer), 8));

        // 2. Build ROM buffer: flag(4B) + volume(4B) + 1022 audio samples
        var romBytes = new Uint8Array(4096);
        // Header: 0x01 00 00 00
        romBytes[0] = 0x01;
        // Volume float32 at bytes 4-7 (default 0.7)
        var volBuf = new ArrayBuffer(4);
        new DataView(volBuf).setFloat32(0, 0.7, true);
        romBytes[4] = new Uint8Array(volBuf)[0];
        romBytes[5] = new Uint8Array(volBuf)[1];
        romBytes[6] = new Uint8Array(volBuf)[2];
        romBytes[7] = new Uint8Array(volBuf)[3];
        // Audio: pad 512 samples to 1022 samples (4088 bytes)
        var audioSamples = 1022;
        var audioF32 = new Float32Array(audioSamples);
        var copyLen = Math.min(ir512.length, audioSamples);
        audioF32.set(ir512.subarray(0, copyLen));
        var audioBytes = new Uint8Array(audioF32.buffer);
        romBytes.set(audioBytes, 8);
        console.log('ROM buffer: ' + romBytes.length + ' bytes, audio: ' + audioSamples + ' samples\n');

        // 3. Backup existing cabinet 8 (0x6F000, slot 7)
        var slot = 7; // 0-indexed, cabinet 8 = ir_cab=8
        var romAddr = 0x00069000 + slot * 4096;
        console.log('=== BACKING UP CABINET 8 @ 0x' + romAddr.toString(16) + ' ===');
        var backupDir = path.join(__dirname, '..', 'backup');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
        var backupPath = path.join(backupDir, 'cabinet_8_0x' + romAddr.toString(16) + '_original.bin');
        if (!fs.existsSync(backupPath)) {
            var original = await readMemory(romAddr, 4096);
            fs.writeFileSync(backupPath, Buffer.from(original));
            console.log('Backup saved: ' + backupPath);
            console.log('First 8 bytes: ' + hexStr(original, 8) + ' f32=' + f32Str(original, 2));
        } else {
            console.log('Backup already exists: ' + backupPath);
        }

        // 4. Erase
        console.log('\n=== ERASING ===');
        var erasePl = [0, romAddr & 0xff, (romAddr >> 8) & 0xff, (romAddr >> 16) & 0xff, (romAddr >> 24) & 0xff, 0, 0, 0];
        try { await sendAndWait(0x21, erasePl); } catch(e) { console.log('Erase ACK: false (expected)'); }
        await new Promise(function(r) { setTimeout(r, 500); });
        console.log('Erased 0x' + romAddr.toString(16));

        // 5. Write 4096 bytes (32 chunks of 128)
        console.log('\n=== WRITING ===');
        var CHUNK = 128;
        for (var off = 0; off < romBytes.length; off += CHUNK) {
            var chunkLen = Math.min(CHUNK, romBytes.length - off);
            var a = romAddr + off;
            var chunk = Array.from(romBytes.slice(off, off + chunkLen));
            var pl = [0, a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff,
                        chunkLen & 0xff, (chunkLen >> 8) & 0xff, (chunkLen >> 16) & 0xff].concat(chunk);
            await sendAndWait(0x22, pl);
            await new Promise(function(r) { setTimeout(r, 100); });
            if (off % 1024 === 0) console.log('  Wrote ' + (off + chunkLen) + ' / 4096 bytes');
        }
        console.log('Write complete');

        // 6. Verify
        console.log('\n=== VERIFYING ===');
        var verify = await readMemory(romAddr, 16);
        var match = true;
        for (var i = 0; i < verify.length && i < romBytes.length; i++) {
            if (verify[i] !== romBytes[i]) { match = false; break; }
        }
        console.log('First 16 bytes: ' + hexStr(verify, 16));
        console.log('Match: ' + match);
        if (match) {
            var fullVerify = await readMemory(romAddr, 4096);
            var allMatch = true;
            for (var i = 0; i < fullVerify.length && i < romBytes.length; i++) {
                if (fullVerify[i] !== romBytes[i]) { allMatch = false; break; }
            }
            console.log('Full 4096 match: ' + allMatch);
        }

        input.closePort();
        output.closePort();
        console.log('\n=== DONE ===');
        console.log('Custom IR uploaded to cabinet 8 (slot 7 @ 0x' + romAddr.toString(16) + ')');
        console.log('Set ir_cab=8 on the pedal or in the UI to hear it.');
        console.log('Set ir_cab=1-7 to hear original built-in cabinets.');
        console.log('To restore, run: node scripts/restore_ir.js');
    } catch(e) {
        console.error('Error:', e.message);
        input.closePort();
        output.closePort();
    }
})();
