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
    var dest = [], bn = 0, ac = 0;
    for (var i = 0; i < source.length; i++) {
        ac = (ac | (source[i] << (bn & 0x1f))) >>> 0;
        bn += 1;
        while (true) { dest.push(ac & 0x7f); ac = (ac >>> 7) >>> 0; if (bn < 7) break; bn -= 7; }
    }
    dest.push(ac & 0x7f);
    return dest;
}
function decode(source) {
    var dest = [], bn = 0, lv = 0;
    for (var i = 0; i < source.length; i++) {
        var b = source[i], m = (0xFFFFFFFF >>> (32 - bn)) >>> 0, ac = b & m;
        if (bn > 0) dest.push((lv & 0x7f) | (ac << (8 - bn)));
        lv = b >>> bn; bn = (bn + 1) % 8;
    }
    if (lv > 0) dest.push(lv);
    return dest;
}
function buildSysex(mt, ct) {
    var lb = [ct.length & 0xff, (ct.length >> 8) & 0xff, (ct.length >> 16) & 0xff];
    var ct2 = [].concat(HEADER, [mt], lb, ct);
    var chk = calcChecksum(ct2.slice(6)); ct2.push(chk);
    return [0xf0].concat(encode(ct2)).concat([0xf7]);
}
var input = new midi.Input(), output = new midi.Output();
input.ignoreTypes(false,false,false);
input.openPort(0); output.openPort(1);
var pending = null;
input.on('message', function(dt, msg) { if (pending) { clearTimeout(pending.timer); var r = pending.resolve; pending = null; r(msg); } });
function snd(mt, pl) {
    return new Promise(function(res, rej) {
        var syx = mt === 0 ? buildSysex(0x00, []) : buildSysex(mt, pl);
        var tm = setTimeout(function() { if (pending) { pending = null; rej(new Error('Timeout')); } }, 10000);
        pending = { resolve: res, timer: tm }; output.send(syx);
    });
}
async function readMem(addr, totalLen) {
    var r = [];
    for (var off = 0; off < totalLen; ) {
        var cl = Math.min(128, totalLen - off), a = addr + off;
        var pl = [0, a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff, cl & 0xff, (cl>>8)&0xff, (cl>>16)&0xff];
        var resp = await snd(0x23, pl);
        var dec = decode(Array.from(resp).slice(1, -1));
        var dl = dec[11] | (dec[12] << 8) | (dec[13] << 16);
        for (var j = 0; j < dl && off + j < totalLen; j++) r.push(dec[14 + j]);
        off += cl;
        await new Promise(function(r2) { setTimeout(r2, 100); });
    }
    return new Uint8Array(r);
}
function hexStr(b, n) { return Array.from(b.slice(0,n)).map(b => b.toString(16).padStart(2,'0')).join(' '); }

(async function() {
    try {
        await snd(0, []);
        console.log('Init OK');

        var romAddr = 0x00070000;
        var backupPath = path.join(__dirname, '..', 'backup', 'cabinet_8_0x6f000_original.bin');
        if (!fs.existsSync(backupPath)) { console.error('Backup not found'); input.closePort(); output.closePort(); return; }
        
        var data = fs.readFileSync(backupPath);
        console.log('Restoring from ' + backupPath + ' (' + data.length + ' bytes)');

        // Erase
        var erasePl = [0, romAddr & 0xff, (romAddr >> 8) & 0xff, (romAddr >> 16) & 0xff, (romAddr >> 24) & 0xff, 0, 0, 0];
        try { await snd(0x21, erasePl); } catch(e) { console.log('Erase ACK: false'); }
        await new Promise(function(r) { setTimeout(r, 500); });
        console.log('Erased 0x' + romAddr.toString(16));

        // Write
        for (var off = 0; off < data.length; off += 128) {
            var cl = Math.min(128, data.length - off), a = romAddr + off;
            var chunk = Array.from(data.slice(off, off + cl));
            var pl = [0, a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff, cl & 0xff, (cl>>8)&0xff, (cl>>16)&0xff].concat(chunk);
            await snd(0x22, pl);
            await new Promise(function(r) { setTimeout(r, 100); });
        }
        console.log('Write complete');

        // Verify
        var v = await readMem(romAddr, 16);
        console.log('First 16: ' + hexStr(v, 16));
        var match = true;
        for (var i = 0; i < v.length; i++) { if (v[i] !== data[i]) { match = false; break; } }
        console.log('Match: ' + match);

        input.closePort(); output.closePort();
        console.log('Restored.');
    } catch(e) { console.error(e.message); input.closePort(); output.closePort(); }
})();
