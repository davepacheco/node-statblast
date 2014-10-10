/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * schema-config.js: JSON schema for statblast configuration
 */

var schemaConfig = {
    'type': 'object',
    'properties': {
	'backend': {
	    'type': 'string',
	    'enum': [ 'statsd' ]
	},
	'statsd_mode': {
	    'type': 'string',
	    'enum': [ 'tcp' ]
	},
	'statsd_host': {
	    'type': 'string'
	},
	'statsd_port': {
	    'type': 'integer',
	    'minimum': 1,
	    'maximum': 65535
	},
	'statsd_queue_npoints': {
	    'type': 'integer',
	    'minimum': 0
	},
	'statsd_queue_nmsecs': {
	    'type': 'integer',
	    'minimum': 0
	},
	'statsd_stats': {
	    'type': 'object',
	    'patternProperties': '[-A-Za-z0-9_.]+',
	    'additionalProperties': {
		'type': 'array',
		'items': { 'type': 'string' }
	    }
	}
    }
};

module.exports = schemaConfig;
