var midi = require('midi');
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
        var decoded = decode(Array.from(resp).slice(1, -1));
        var readLen = decoded[11] | (decoded[12] << 8) | (decoded[13] << 16);
        var data = decoded.slice(14, 14 + readLen);
        for (var j = 0; j < data.length && off + j < totalLen; j++) {
            result.push(data[j]);
        }
        off += chunkLen;
        await new Promise(function(r) { setTimeout(r, 100); });
    }
    return new Uint8Array(result);
}
function f32Str(buf, n) {
    var f32 = new Float32Array(buf.slice(0, n * 4).buffer);
    var parts = [];
    for (var i = 0; i < f32.length; i++) parts.push(f32[i].toFixed(6));
    return '[' + parts.join(', ') + ']';
}
function asciiStr(buf, n) {
    var s = '';
    for (var i = 0; i < Math.min(buf.length, n); i++) {
        s += (buf[i] >= 32 && buf[i] < 127) ? String.fromCharCode(buf[i]) : '.';
    }
    return s;
}
function hexStr(buf, n) {
    var parts = [];
    for (var i = 0; i < Math.min(buf.length, n); i++) parts.push(buf[i].toString(16).padStart(2, '0'));
    return parts.join(' ');
}

(async function() {
    try {
        console.log('Init...');
        await sendAndWait(0, []);
        console.log('OK\n');

        // Each cabinet = 4096 bytes. 8 cabinets from 0x68000 (header) + 8 * 4096 = 0x8000
        // Header area: 0x68000-0x68FFF (4KB)
        // Cabinets: 0x69000-0x70FFF (32KB)
        // Let's see ALL cabinets as 4096-byte blocks
        var CAB_START = 0x00068000;
        var CAB_SIZE = 4096;
        var NUM_CABS = 8;

        console.log('=== FULL CABINET OVERVIEW ===');
        for (var c = 0; c < NUM_CABS; c++) {
            var addr = CAB_START + c * CAB_SIZE;
            // Read first 8 bytes for first float, and first 64 for ascii
            var d = await readMemory(addr, 8);
            var f = new Float32Array(d.buffer);
            console.log('Cabinet ' + (c+1) + ' @ 0x' + addr.toString(16) + ': first sample=' + f[0].toFixed(6) + ' second=' + f[1].toFixed(6));
        }

        // Now look at each cabinet's full 4096 bytes as float32
        // Find where the audio data actually starts (nonzero samples)
        // and where it ends (last nonzero sample)
        console.log('\n=== CABINET AUDIO RANGES (4096 bytes = 1024 samples each) ===');
        for (var c = 0; c < NUM_CABS; c++) {
            var addr = CAB_START + c * CAB_SIZE;
            var d = await readMemory(addr, CAB_SIZE);
            var f32 = new Float32Array(d.buffer);
            // Count nonzero samples
            var firstNonzero = -1, lastNonzero = -1;
            for (var i = 0; i < f32.length; i++) {
                if (Math.abs(f32[i]) > 1e-10) {
                    if (firstNonzero === -1) firstNonzero = i;
                    lastNonzero = i;
                }
            }
            // All the data as text (first 64 and last 64)
            var ascFirst = asciiStr(d, 64);
            var f32first = f32Str(d, 8);
            var f32last4 = f32Str(d.slice((CAB_SIZE-4)*4), 1);
            var firstFewBytes = hexStr(d, 8);
            console.log('Cabinet ' + (c+1) + ': first=' + firstNonzero + ' last=' + lastNonzero + ' peak=' + f32.reduce(function(m,v) { return Math.max(m,Math.abs(v)); }, 0).toFixed(6));
            console.log('  hex(8): ' + firstFewBytes + '  f32[0..7]: ' + f32first);
            console.log('  ascii(64): "' + ascFirst.replace(/[.]+$/, '') + '"');
            // If first sample is not index 0, report what's before
            if (firstNonzero > 0) {
                console.log('  non-audio header: ' + hexStr(d, Math.min(firstNonzero*4, 32)) + ' bytes');
            }
            // If cabinet has real IR data, show full stats
            if (lastNonzero > 0) {
                var nonzeroLen = lastNonzero - firstNonzero + 1;
                console.log('  nonzero samples: ' + nonzeroLen + ' (out of 1024)');
                // Median sample (for IR energy distribution check)
                var mid = Math.floor(f32.length / 2);
                console.log('  sample[256]: ' + f32[256].toFixed(6) + '  sample[512]: ' + f32[512].toFixed(6) + '  sample[768]: ' + f32[768].toFixed(6));
            }
        }

        // Check for a separate mapping table at 0x68000
        console.log('\n=== CABINET 0 HEADER (0x68000) DETAILED ===');
        var d = await readMemory(0x00068000, 512);
        console.log('First 32 bytes hex: ' + hexStr(d, 32));
        console.log('As f32: ' + f32Str(d, 8));
        // The values 30, 40, 50, 60, 70, 80, 90, 100 look like parameter values
        // Could this be the DEFAULT preset for cabinet 1?
        // Let's check if there are similar patterns at other cabinet headers
        console.log('\n=== ALL CABINET HEADERS (first 32 bytes, interleaved) ===');
        for (var c = 1; c < NUM_CABS; c++) {
            var addr = CAB_START + c * CAB_SIZE;
            var d = await readMemory(addr, 32);
            console.log('Cabinet ' + (c+1) + ' @ 0x' + addr.toString(16) + ': ' + hexStr(d, 32) + '  f32=' + f32Str(d, 4) + '  ascii="' + asciiStr(d, 16).replace(/[.]+$/, '') + '"');
        }

        input.closePort();
        output.closePort();
        console.log('\nDone');
    } catch (e) {
        console.error('Error:', e.message);
        input.closePort();
        output.closePort();
    }
})();
