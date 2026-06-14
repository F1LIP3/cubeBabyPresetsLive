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

// Read from memory in 128-byte chunks
async function readMemory(addr, totalLen) {
    var result = [];
    var CHUNK = 128;
    for (var off = 0; off < totalLen; ) {
        var chunkLen = Math.min(CHUNK, totalLen - off);
        var a = addr + off;
        var pl = [0, a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff,
                    chunkLen & 0xff, (chunkLen >> 8) & 0xff, (chunkLen >> 16) & 0xff];
        var resp = await sendAndWait(0x23, pl);
        // Parse the response: skip F0, 00 32 header from 7-bit encoding
        var decoded = decode(Array.from(resp).slice(1, -1));
        // decoded = [00 59, msgType, len(3), cmd, addr(4), dataLen(3), data...]
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

        // Read all 8 slots
        console.log('=== SLOTS 0-7 (first 64 bytes) ===');
        for (var s = 0; s < 8; s++) {
            var addr = 0x00069000 + s * 2048;
            var d = await readMemory(addr, 64);
            console.log('Slot ' + s + ' @ 0x' + addr.toString(16) + ': f32=' + f32Str(d, 8) + ' ascii="' + asciiStr(d, 64).replace(/\.+$/, '') + '"');
        }

        // Full 8192 bytes string scan
        console.log('\n=== 8192 BYTE STRING SCAN ===');
        var big = await readMemory(0x00069000, 8192);
        var cur = '';
        for (var i = 0; i < big.length; i++) {
            if (big[i] >= 32 && big[i] < 127) { cur += String.fromCharCode(big[i]); }
            else { if (cur.length >= 4) console.log('  @' + (i - cur.length) + ': "' + cur + '"'); cur = ''; }
        }
        if (cur.length >= 4) console.log('  @' + (big.length - cur.length) + ': "' + cur + '"');

        // Check what's before and after slot boundary
        console.log('\n=== SLOT BOUNDARIES ===');
        for (var s = 0; s < 3; s++) {
            var a = 0x00069000 + s * 2048 + 2040;
            var d = await readMemory(a, 16);
            console.log('Slot ' + s + ' tail: ' + hexStr(d, 16) + ' ' + f32Str(d, 2) + ' ascii="' + asciiStr(d, 16) + '"');
        }

        // Full slots 0, 1, 3
        console.log('\n=== FULL SLOTS (2048 bytes) ===');
        for (var si = 0; si < [0, 1, 3].length; si++) {
            var sidx = [0, 1, 3][si];
            var a = 0x00069000 + sidx * 2048;
            var d = await readMemory(a, 2048);
            var f32 = new Float32Array(d.buffer);
            var nz = [];
            for (var j = 0; j < f32.length; j++) { if (f32[j] !== 0) nz.push(j); }
            var peak = 0;
            for (var j = 0; j < f32.length; j++) { var abs = Math.abs(f32[j]); if (abs > peak) peak = abs; }
            console.log('Slot ' + sidx + ': nonzero=' + nz[0] + '..' + nz[nz.length-1] + ' peak=' + peak.toFixed(6));
            console.log('  first 16: ' + f32Str(d, 16));
            console.log('  last 16:  ' + f32Str(d.slice(2048-64), 16));
        }

        // Cabinet name scan
        console.log('\n=== CABINET NAME SCAN (0x60000-0x90000) ===');
        var names = ['TweedDeluxe','Showman','Roland','Marshall','Vox','Twin','Bogner','ENGL','Peavey',
                       'Orange','Mesa','Diezel','Supro','Matchless','Aguilar','AMPEG','EDEN','patchCAB'];
        for (var addr = 0x00060000; addr <= 0x00090000; addr += 0x400) {
            try {
                var d = await readMemory(addr, 64);
                var a = asciiStr(d, 64);
                for (var ni = 0; ni < names.length; ni++) {
                    if (a.indexOf(names[ni]) !== -1) {
                        console.log('"' + names[ni] + '" @ 0x' + addr.toString(16) + ': hex=' + hexStr(d, 16) + ' f32=' + f32Str(d, 4));
                        break;
                    }
                }
            } catch (e) {}
        }

        // First sample of all 8 slots
        console.log('\n=== FIRST SAMPLE OF ALL SLOTS ===');
        for (var s = 0; s < 8; s++) {
            var d = await readMemory(0x00069000 + s * 2048, 4);
            var f = new Float32Array(d.buffer);
            console.log('Slot ' + s + ': ' + f[0].toFixed(6));
        }

        input.closePort();
        output.closePort();
        console.log('\nDone');
    } catch (e) {
        console.error('Error:', e.message);
        console.error(e.stack);
        input.closePort();
        output.closePort();
    }
})();
