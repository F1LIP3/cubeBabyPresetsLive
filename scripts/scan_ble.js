var noble = require('@abandonware/noble');

var MIDI_UUID = '03b80e5aede84b33a7516ce34ec4c700';

console.log('Scanning for 60 seconds...');
console.log('Make sure Cube Baby is ON and NOT connected via USB.');
console.log('Try pressing/holding footswitches to enter pairing mode.');
console.log('');

var found = {};
var scanCount = 0;

noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    noble.startScanning([], true);
  } else {
    console.log('BLE adapter:', state);
  }
});

noble.on('discover', function(peripheral) {
  scanCount++;
  var adv = peripheral.advertisement || {};
  var name = adv.localName || '(unnamed)';
  var id = peripheral.id || peripheral.address;
  var uuids = adv.serviceUuids || [];
  var mfg = adv.manufacturerData;

  if (found[id]) return;
  found[id] = true;

  var line = '[' + id + '] ' + name + ' RSSI:' + peripheral.rssi;
  if (uuids.length) line += ' UUIDs:' + uuids.join(',');
  if (mfg) line += ' mfg:' + mfg.toString('hex').substring(0, 20);
  
  var hasMidi = uuids.some(function(u) {
    return u.toLowerCase().indexOf('03b80e5a') >= 0;
  });
  if (hasMidi) line += ' *** MIDI! ***';
  
  // Check if manufacturer data looks familiar (Silicon Labs = 0x0047, 0x02FF)
  if (mfg && mfg.length >= 2) {
    var companyId = mfg.readUInt16LE(0);
    if (companyId === 0x0047 || companyId === 0x02FF) {
      line += ' (Silicon Labs?)';
    }
  }

  console.log(line);

  // Try connecting if name contains relevant keywords
  var nameUpper = (name || '').toUpperCase();
  if (nameUpper.indexOf('CUBE') >= 0 || nameUpper.indexOf('BABY') >= 0 || 
      nameUpper.indexOf('CUVAVE') >= 0 || nameUpper.indexOf('LEKATO') >= 0 ||
      nameUpper.indexOf('NUX') >= 0) {
    console.log('  => MATCH! Connecting...');
    peripheral.connect(function(err) {
      if (err) { console.log('  => Connect failed:', err.message); return; }
      console.log('  => Connected!');
      peripheral.discoverServices(null, function(err, services) {
        if (err) { console.log('  => Service discovery failed:', err.message); return; }
        services.forEach(function(s) {
          console.log('  Service: ' + s.uuid);
          s.discoverCharacteristics(null, function(err, chars) {
            if (err) return;
            chars.forEach(function(c) {
              console.log('    Char: ' + c.uuid + ' [' + c.properties.join(',') + ']');
            });
          });
        });
        setTimeout(function() { peripheral.disconnect(function() {}); }, 5000);
      });
    });
  }
});

setTimeout(function() {
  console.log('\n=== Scan ended ===');
  console.log('Total devices seen: ' + scanCount);
  console.log('Unique devices: ' + Object.keys(found).length);
  process.exit(0);
}, 60000);
