var midi = require('midi');
var HEADER = new Uint8Array([0x00, 0x59]);

function calcChecksum(data) {
    var s = 0;
    for (var i = 0; i < data.length; i++) s = (s + data[i]) & 0xff;
    return (~s) & 0xff;
}

function encode(source) {
    var dest = [];
    var bitNum = 0, accum = 0;
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

function buildSysex(msgType, content) {
    var lenBytes = [content.length & 0xff, (content.length >> 8) & 0xff, (content.length >> 16) & 0xff];
    var cleartext = new Uint8Array([...HEADER, msgType, ...lenBytes, ...content]);
    var checksum = calcChecksum(cleartext.slice(6));
    return [0xf0, ...encode(new Uint8Array([...cleartext, checksum])), 0xf7];
}

var input = new midi.Input();
var output = new midi.Output();
input.ignoreTypes(false, false, false);
input.openPort(0);
output.openPort(1);

var pending = null;

input.on('message', function(dt, msg) {
    console.log('RX callback');
    try {
        if (pending) {
            clearTimeout(pending.timer);
            var r = pending.resolve;
            pending = null;
            r(msg);
        }
    } catch (e) { console.log('RX err:', e.message); }
});

function sendAndWait(msgType, payload) {
    return new Promise(function(resolve, reject) {
        var sysex = msgType === 0 ? buildSysex(0x00, []) : buildSysex(msgType, payload);
        console.log('TX:', sysex.map(function(b) { return b.toString(16).padStart(2,'0'); }).join(' '));
        var timer = setTimeout(function() {
            if (pending) { console.log('TIMEOUT'); pending = null; reject(new Error('Timeout')); }
        }, 5000);
        pending = { resolve: resolve, timer: timer };
        output.send(sysex);
    });
}

(async function() {
    try {
        console.log('Init...');
        await sendAndWait(0, []);
        console.log('OK!');
        input.closePort();
        output.closePort();
        console.log('Done');
    } catch (e) {
        console.error('Error:', e.message);
        input.closePort();
        output.closePort();
    }
})();
