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

// Write to memory (cmd = 0x22)
async function writeMemory(addr, data, cmd) {
    var CHUNK = 128;
    for (var off = 0; off < data.length; ) {
        var chunkLen = Math.min(CHUNK, data.length - off);
        var a = addr + off;
        var chunk = Array.from(data.slice(off, off + chunkLen));
        var pl = [cmd !== undefined ? cmd : 0, a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff,
                    chunkLen & 0xff, (chunkLen >> 8) & 0xff, (chunkLen >> 16) & 0xff].concat(chunk);
        await sendAndWait(0x22, pl);
        off += chunkLen;
        await new Promise(function(r) { setTimeout(r, 100); });
    }
}

// Erase (0x21)
async function eraseSector(addr) {
    var pl = [0, addr & 0xff, (addr >> 8) & 0xff, (addr >> 16) & 0xff, (addr >> 24) & 0xff, 0, 0, 0];
    try {
        await sendAndWait(0x21, pl);
    } catch(e) { /* ACK is false but erase still works */ }
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

(function() {
    var bdir = path.join(__dirname, '..', 'backup');
    if (!fs.existsSync(bdir)) fs.mkdirSync(bdir);

    (async function() {
        try {
            console.log('Init...');
            await sendAndWait(0, []);
            console.log('OK');

            var CAB_START = 0x00068000;
            var CAB_SIZE = 4096;
            var NUM_CABS = 8;

            // Backup all cabinets
            console.log('\n=== BACKING UP ALL ' + NUM_CABS + ' CABINETS ===');
            for (var c = 0; c < NUM_CABS; c++) {
                var addr = CAB_START + c * CAB_SIZE;
                console.log('Reading cabinet ' + (c+1) + ' @ 0x' + addr.toString(16) + ' (' + CAB_SIZE + ' bytes)...');
                var d = await readMemory(addr, CAB_SIZE);
                var fname = path.join(bdir, 'cabinet_' + (c+1) + '_0x' + addr.toString(16) + '.bin');
                fs.writeFileSync(fname, Buffer.from(d));
                console.log('  Saved to ' + fname + ' (' + d.length + ' bytes)');
            }

            // Now test restore on 0x69000 (cabinet 2 = ir_cab=1)
            // Read cabinet 2 data (from file - already have it in memory)
            var restoreAddr = 0x00069000;
            var restoreData = fs.readFileSync(path.join(bdir, 'cabinet_2_0x69000.bin'));

            console.log('\n=== TESTING ERASE+WRITE on 0x69000 ===');
            console.log('Erasing 0x' + restoreAddr.toString(16) + '...');
            await eraseSector(restoreAddr);
            console.log('Erase done (ACK may be false, OK)');

            console.log('Writing ' + restoreData.length + ' bytes back...');
            // Write in 128-byte chunks
            var CHUNK = 128;
            for (var off = 0; off < restoreData.length; off += CHUNK) {
                var chunkLen = Math.min(CHUNK, restoreData.length - off);
                var a = restoreAddr + off;
                var chunk = Array.from(restoreData.slice(off, off + chunkLen));
                var pl = [0, a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff,
                            chunkLen & 0xff, (chunkLen >> 8) & 0xff, (chunkLen >> 16) & 0xff].concat(chunk);
                await sendAndWait(0x22, pl);
                await new Promise(function(r) { setTimeout(r, 100); });
                if (off % 1024 === 0) console.log('  Wrote ' + (off + chunkLen) + ' / ' + restoreData.length + ' bytes');
            }
            console.log('  Write done');

            // Verify by reading back
            console.log('Verifying...');
            var verify = await readMemory(restoreAddr, 64);
            var match = true;
            for (var i = 0; i < verify.length && i < restoreData.length; i++) {
                if (verify[i] !== restoreData[i]) { match = false; break; }
            }
            console.log('  First 64 bytes match: ' + match);
            if (match) {
                // Deep verify full 4096
                var fullVerify = await readMemory(restoreAddr, CAB_SIZE);
                var allMatch = true;
                for (var i = 0; i < fullVerify.length && i < restoreData.length; i++) {
                    if (fullVerify[i] !== restoreData[i]) { allMatch = false; break; }
                }
                console.log('  Full 4096 bytes match: ' + allMatch);
            }

            input.closePort();
            output.closePort();
            console.log('\nDone. Test ir_cab=1 on pedal to verify sound restored.');
        } catch (e) {
            console.error('Error:', e.message);
            input.closePort();
            output.closePort();
        }
    })();
})();
