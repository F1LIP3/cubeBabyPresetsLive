var { SerialPort } = require('serialport');
var readline = require('readline');

function encode(source) {
  var dest = [];
  var bitNum = 0;
  var accum = 0;
  for (var i = 0; i < source.length; i++) {
    var b = source[i];
    accum = (accum | (b << (bitNum & 0x1f))) >>> 0;
    bitNum += 1;
    while (true) {
      dest.push(accum & 0x7f);
      accum = accum >>> 7;
      if (bitNum < 7) break;
      bitNum -= 7;
    }
  }
  dest.push(accum & 0x7f);
  return Buffer.from(dest);
}

function calcChecksum(data) {
  var sum = 0;
  for (var i = 0; i < data.length; i++) {
    sum = (sum + data[i]) & 0xff;
  }
  return (~sum) & 0xff;
}

function buildNameRequest() {
  var header = Buffer.from([0x00, 0x59]);
  var msgType = 0x11;
  var content = Buffer.alloc(0);
  var lenBytes = Buffer.from([
    content.length & 0xff,
    (content.length >> 8) & 0xff,
    (content.length >> 16) & 0xff,
  ]);
  var cleartext = Buffer.concat([header, Buffer.from([msgType]), lenBytes, content]);
  var checksum = calcChecksum(cleartext.slice(6));
  var full = Buffer.concat([cleartext, Buffer.from([checksum])]);
  var encoded = encode(full);
  return Buffer.concat([Buffer.from([0xf0]), encoded, Buffer.from([0xf7])]);
}

// Build a simple ReadMemory message for a known good address
function buildReadMemory(cmd, addr, len) {
  var header = Buffer.from([0x00, 0x59]);
  var msgType = 0x23;
  var addrBytes = Buffer.alloc(4);
  addrBytes.writeUInt32LE(addr, 0);
  var lenBytes = Buffer.from([len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff]);
  var content = Buffer.concat([Buffer.from([cmd]), addrBytes, lenBytes]);
  var len3 = Buffer.from([content.length & 0xff, (content.length >> 8) & 0xff, (content.length >> 16) & 0xff]);
  var cleartext = Buffer.concat([header, Buffer.from([msgType]), len3, content]);
  var checksum = calcChecksum(cleartext.slice(6));
  var full = Buffer.concat([cleartext, Buffer.from([checksum])]);
  var encoded = encode(full);
  return Buffer.concat([Buffer.from([0xf0]), encoded, Buffer.from([0xf7])]);
}

async function main() {
  var portPath = process.argv[2] || 'COM3';
  var action = process.argv[3] || 'read';  // 'read' or 'send'

  console.log('Port: ' + portPath + ', Action: ' + action);

  var port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });

  await new Promise(function(resolve, reject) {
    port.open(function(err) {
      if (err) { console.log('Open error:', err.message); process.exit(1); }
      console.log('Port opened!');
      resolve();
    });
  });

  if (action === 'send') {
    // Send ReadMemory: cab=0 addr=0x2000, len=16
    // (address for preset settings on the pedal)
    // Actually let's try requesting name first - that we know works
    var msg = buildNameRequest();
    console.log('Sending NameRequest (' + msg.length + 'B): ' + msg.toString('hex'));

    await new Promise(function(resolve, reject) {
      port.write(msg, function(err) {
        if (err) { console.log('Write error:', err.message); process.exit(1); }
        console.log('Sent!');
        resolve();
      });
    });
  } else {
    console.log('Reading mode: power-cycle the pedal now and watch for data...');
  }

  // Read with timeout
  var chunks = [];
  var timeout = setTimeout(function() {
    console.log('\n=== TIMEOUT ===');
    printAll(chunks, port);
  }, 10000);

  port.on('data', function(data) {
    clearTimeout(timeout);
    chunks.push(data);
    console.log('Got ' + data.length + ' bytes: ' + data.toString('hex'));
    timeout = setTimeout(function() {
      console.log('\n=== RECEIVED ALL ===');
      printAll(chunks, port);
    }, 1000);
  });

  port.on('error', function(err) {
    console.log('Port error:', err.message);
  });
}

function printAll(chunks, port) {
  var all = Buffer.concat(chunks);
  console.log('Total: ' + all.length + ' bytes');
  if (all.length > 0) {
    console.log('Hex: ' + all.toString('hex'));
    var hexArr = [];
    for (var i = 0; i < all.length; i++) {
      hexArr.push(all[i].toString(16).padStart(2, '0'));
    }
    console.log('Bytes: ' + hexArr.join(' '));

    // Extract SysEx messages
    var start = -1;
    var n = 0;
    for (var i = 0; i < all.length; i++) {
      if (all[i] === 0xf0) start = i;
      if (all[i] === 0xf7 && start >= 0) {
        var sysex = all.slice(start, i + 1);
        console.log('SysEx #' + (n++) + ': ' + sysex.toString('hex'));
        start = -1;
      }
    }
  }
  port.close(function() { process.exit(0); });
}

main();
