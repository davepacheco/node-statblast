/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * tst.schema.js: test the configurations chema
 */

var mod_assertplus = require('assert-plus');
var mod_jsprim = require('jsprim');
var schema = require('../lib/schema-config');
var okay = [
    /* empty config */
    {},
    /* valid values */
    { 'backend': 'statsd' },
    { 'statsd_mode': 'tcp' },
    { 'statsd_host': 'foo' },
    { 'statsd_port': 12345 },
    { 'statsd_queue_npoints': 12345 },
    { 'statsd_queue_nmsecs': 12345 },
    { 'statsd_stast': [] },
    { 'statsd_stats': {
	'myapp.mystat': [ 'foo.bar', '%_name.%host' ]
      } }
];
var bad = [
    [ { 'backend': 'junk' }, /property "backend":/ ],
    [ { 'backend': 5 }, /property "backend":/ ],
    [ { 'backend': true }, /property "backend":/ ],
    [ { 'backend': {} }, /property "backend":/ ],
    [ { 'backend': [] }, /property "backend":/ ],
    [ { 'statsd_mode': 'udp' }, /property "statsd_mode":/ ],
    [ { 'statsd_mode': 5 }, /property "statsd_mode":/ ],
    [ { 'statsd_mode': true }, /property "statsd_mode":/ ],
    [ { 'statsd_mode': {} }, /property "statsd_mode":/ ],
    [ { 'statsd_mode': [] }, /property "statsd_mode":/ ],
    [ { 'statsd_port': 80000 }, /property "statsd_port":/ ],
    [ { 'statsd_port': -5 }, /property "statsd_port":/ ],
    [ { 'statsd_port': {} }, /property "statsd_port":/ ],
    [ { 'statsd_stats': true }, /property "statsd_stats":/ ],
    [ { 'statsd_stats': 5 }, /property "statsd_stats":/ ],
    [ { 'statsd_stats': 'asdf' }, /property "statsd_stats":/ ]
];
var error;

console.error('SUCCESS CASES');
okay.forEach(function (value) {
	console.error('value: %s', JSON.stringify(value));
	error = mod_jsprim.validateJsonObject(schema, value);
	mod_assertplus.ok(error === null);
	
});

console.error('\nERROR CASES');
bad.forEach(function (testcase) {
	var value = testcase[0];
	var message = testcase[1];
	console.error('value: %s', JSON.stringify(value));
	error = mod_jsprim.validateJsonObject(schema, value);
	mod_assertplus.ok(error !== null, 'expected error');
	console.error('    message: %s', error.message);
	mod_assertplus.ok(message.test(error.message));
});

console.log('tst.schema.js okay');
