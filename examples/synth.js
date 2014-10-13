/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * examples/synth.js: example usage of statblaster to generate synthetic data
 * once per second.
 */

var mod_assert = require('assert');
var mod_os = require('os');
var mod_statblast = require('../lib/statblast');

var hostname = mod_os.hostname().replace(/\..*/g, '');
var blaster = mod_statblast.createBlaster({
    /* all arguments optional, but you almost certainly want statsd_stats */
    'backend': 'statsd',

    'statsd_mode': 'udp',
    'statsd_host': process.env['STATBLAST_HOST'] || '127.0.0.1',
    'statsd_port': 8125,

    /*
     * Queue up to 2 seconds' worth of data or 500 datapoints (whichever is
     * smaller) before dropping if needed.
     */
    'statsd_queue_npoints': 1000,
    'statsd_queue_nmsecs': 2000,

    /*
     * With this configuration, statblast creates two families of stats.
     * The values of %_name, %host, and %method come from metadata supplied
     * each time you emit the stat.
     */
    'statsd_stats': {
        'myapp.requests': [
	    '%_name.byhost.%host',
	    '%_name.bymethod.%method'
	]
    }
});

/*
 * createBlaster will return an Error in the event of invalid configuration.
 */
mod_assert.ok(!(blaster instanceof Error));

blaster.on('warn', function (err) {
	console.error('statblaster: %s', err.message);
});

setInterval(function () {
	/*
	 * This sends two values to statsd:
	 *
	 *    myapp.requests.host001    5
	 *    myapp.requests.GET        5
	 *
	 * These are driven by the configuration above.
	 */
	blaster.counter('myapp.requests', {
	    'host': hostname,
	    'method': 'GET'
	}, 1);
	
	/*
	 * Ditto, but with a gauge.
	 */
	blaster.gauge('myapp.concurrent_requests', {
	    'host': hostname
	}, 1);
}, 1000);
