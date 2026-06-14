var midi = require('midi');
var HEADER = [0x00, 0x59];

function calcChecksum(data) {
    var s = 0;
    for (var i = 0; i < data.length; i++) s = (s + data[i]) & 0xff;
    return (~s) & 0xff;
}
function encode(src) {
    var d = [], bn = 0, ac = 0;
    for (var i = 0; i < src.length; i++) {
        ac = (ac | (src[i] << (bn & 0x1f))) >>> 0; bn += 1;
        while (true) { d.push(ac & 0x7f); ac = (ac >>> 7) >>> 0; if (bn < 7) break; bn -= 7; }
    }
    d.push(ac & 0x7f);
    return d;
}
function decode(src) {
    var d = [], bn = 0, lv = 0;
    for (var i = 0; i < src.length; i++) {
        var b = src[i], m = (0xFFFFFFFF >>> (32 - bn)) >>> 0, ac = b & m;
        if (bn > 0) d.push((lv & 0x7f) | (ac << (8 - bn)));
        lv = b >>> bn; bn = (bn + 1) % 8;
    }
    if (lv > 0) d.push(lv);
    return d;
}
function buildSysex(mt, ct) {
    var lb = [ct.length & 0xff, (ct.length >> 8) & 0xff, (ct.length >> 16) & 0xff];
    var ct2 = [].concat(HEADER, [mt], lb, ct);
    var chk = calcChecksum(ct2.slice(6)); ct2.push(chk);
    return [0xf0].concat(encode(ct2)).concat([0xf7]);
}
var input = new midi.Input(), output = new midi.Output();
input.ignoreTypes(false,false,false);
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
function snd(mt, pl) {
    return new Promise(function(res, rej) {
        var syx = mt === 0 ? buildSysex(0x00, []) : buildSysex(mt, pl);
        var tm = setTimeout(function() { if (pending) { pending = null; rej(new Error('Timeout')); } }, 10000);
        pending = { resolve: res, timer: tm };
        output.send(syx);
    });
}
async function readMem(addr, len) {
    var r = [];
    for (var off = 0; off < len; ) {
        var cl = Math.min(128, len - off), a = addr + off;
        var pl = [0, a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff, cl & 0xff, (cl>>8)&0xff, (cl>>16)&0xff];
        var resp = await snd(0x23, pl);
        var dec = decode(Array.from(resp).slice(1, -1));
        var dl = dec[11] | (dec[12] << 8) | (dec[13] << 16);
        for (var j = 0; j < dl && off + j < len; j++) r.push(dec[14 + j]);
        off += cl;
        await new Promise(function(r2) { setTimeout(r2, 100); });
    }
    return new Uint8Array(r);
}
function hexStr(b, n) {
    var s = '';
    for (var i = 0; i < Math.min(b.length, n); i++) s += b[i].toString(16).padStart(2, '0') + ' ';
    return s.trim();
}
function ascStr(b, n) {
    var s = '';
    for (var i = 0; i < Math.min(b.length, n); i++) s += (b[i] >= 32 && b[i] < 127) ? String.fromCharCode(b[i]) : '.';
    return s;
}
function f32Str(b, n) {
    var f = new Float32Array(b.slice(0, n * 4).buffer);
    return '[' + Array.from(f).map(function(v) { return v.toFixed(6); }).join(',') + ']';
}

(async function() {
    try {
        await snd(0, []);
        console.log('OK\n');

        // Read cabinet 1 header area - look for strings
        var seen = {};
        console.log('=== STRING SCAN 0x00068000-0x0006A000 ===');
        for (var a = 0x00068000; a < 0x0006A000; a += 64) {
            var d = await readMem(a, 64);
            var asc = ascStr(d, 64);
            var clean = asc.replace(/[.]+$/g, '').trim();
            if (clean.length >= 3 && !seen[clean]) {
                seen[clean] = true;
                console.log('  @' + (a - 0x00068000).toString(16).padStart(4, '0') + ': "' + clean + '"');
            }
        }

        // Now compare: cabinet 1 (should have metadata) vs our modified area
        console.log('\n=== CABINET 1 FIRST 256 BYTES (0x68000) ===');
        var d = await readMem(0x00068000, 256);
        for (var i = 0; i < 256; i += 16) {
            var hex = hexStr(d.slice(i, i + 16), 16);
            var asc = ascStr(d.slice(i, i + 16), 16);
            var f32 = (i % 64 === 0) ? f32Str(d.slice(i, i + 8), 8) : '';
            console.log('  ' + i.toString(16).padStart(4, '0') + ': ' + hex + '  ' + asc + (f32 ? '  f32=' + f32 : ''));
        }

        // Check if 0x6A000 has metadata (cabinet 2)
        console.log('\n=== CABINET 2 FIRST 64 BYTES (0x6A000) ===');
        var d = await readMem(0x0006A000, 64);
        console.log('hex: ' + hexStr(d, 64));
        console.log('asc: "' + ascStr(d, 64) + '"');
        console.log('f32: ' + f32Str(d, 8));

        // Cabinet 2 header area details
        console.log('\n=== CABINET 2 FIRST 256 BYTES (0x6A000) ===');
        var d = await readMem(0x0006A000, 256);
        for (var i = 0; i < 256; i += 16) {
            var hex = hexStr(d.slice(i, i + 16), 16);
            var asc = ascStr(d.slice(i, i + 16), 16);
            console.log('  ' + i.toString(16).padStart(4, '0') + ': ' + hex + '  ' + asc);
        }

        // Check cabinet 3 header
        console.log('\n=== CABINET 3 FIRST 64 BYTES (0x6C000) ===');
        var d = await readMem(0x0006C000, 64);
        console.log('hex: ' + hexStr(d, 64));
        console.log('asc: "' + ascStr(d, 64) + '"');

        input.closePort();
        output.closePort();
        console.log('\nDone');
    } catch(e) {
        console.error(e.message);
        input.closePort();
        output.closePort();
    }
})();
