/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_assertplus = require('assert-plus');
var mod_extsprintf = require('extsprintf');
var mod_events = require('events');
var mod_jsprim = require('jsprim');
var mod_net = require('net');
var mod_util = require('util');

var EventEmitter = mod_events.EventEmitter;
var VError = require('verror');
var sprintf = mod_extsprintf.sprintf;

var schemaConfig = require('./schema-config');

/* Public interface */
exports.createBlaster = createBlaster;

/*
 * Public entry point for creating a Blaster.  Takes configuration as specified
 * in the JSON schema and configures a Blaster.  Returns an error describing a
 * validation problem, if any.
 */
function createBlaster(conf)
{
	var error, blaster;

	mod_assertplus.object(conf, 'conf');
	error = mod_jsprim.validateJsonObject(schemaConfig, conf);
	if (error !== null)
		return (error);

	blaster = new StatsdBlaster(conf);
	return (blaster);
}

/*
 * Blaster states
 */

var BLASTER_S_NOMINAL		= 'nominal';	/* everything okay */
var BLASTER_S_NOTCONN		= 'notconn';	/* not connected */
var BLASTER_S_CONNECTING	= 'connecting';	/* not connected */
var BLASTER_S_CONNWAIT 		= 'waiting';	/* waiting to retry */

/*
 * Blaster is the main interface through which consumers emit stat data.
 *
 * The connection is managed via a state machine:
 *
 *     NOTCONN (not connected -- initial state)
 *
 *             b_socket        === null
 *             b_connect_start === null
 *             b_connected     === null
 *             b_wait_start    === null
 *             b_error         !== null (indicates last error
 *                                      or "never connected")
 *
 *     CONNECTING (connection in progress)
 *
 *             b_socket        !== null
 *             b_connect_start !== null
 *             b_connected     === null
 *             b_wait_start    === null
 *             b_error         !== null (indicates last error
 *                                      or "never connected")
 *
 *     NOMINAL   (connection okay)
 *
 *             b_socket        !== null
 *             b_connect_start !== null
 *             b_connected     !== null
 *             b_wait_start    === null
 *             b_error         === null
 *
 *     CONNWAIT (waiting to attempt to reconnect due to previous failure)
 *
 *             b_socket        === null
 *             b_connect_start === null
 *             b_connected     === null
 *             b_wait_start    !== null
 *             b_error         !== null (indicates last error)
 *
 * The state machine looks like this:
 *
 *          |
 *          v
 *     +---------+  immediate    +------------+  'connect'   +-----------+
 *     | NOTCONN | ------------> | CONNECTING | -----------> | CONNECTED |
 *     +---------+               +------------+              +-----------+
 *          ^                           |                          |
 *          |                           |                          |
 *          |                           | 'error' event            |
 *          |                           v                          |
 *          |      timeout         +----------+                    | 'end' or
 *          +----------------------| CONNWAIT | -------------------+ 'error'
 *                                 +----------+                      event
 */
function StatsdBlaster(conf)
{
	mod_assertplus.object(conf, 'conf');
	mod_assertplus.equal('tcp', conf.statsd_mode);

	/* configuration */
	this.b_host = conf.statsd_host || '127.0.0.1';
	this.b_port = conf.statsd_port || 8125;
	this.b_maxqlen = conf.statsd_queue_npoints || 1000;
	this.b_maxqmsecs = conf.statsd_queue_nmsecs || 2000;
	this.b_stats = mod_jsprim.deepCopy(conf.statsd_stats);
	this.b_onconnect = this.onSocketConnect.bind(this);
	this.b_onerror = this.onSocketError.bind(this);
	this.b_onend = this.onSocketEnd.bind(this);

	/* dynamic state */
	this.b_state = BLASTER_S_NOTCONN;
	this.b_nconnects = 0;
	this.b_nattempts = 0;
	this.b_error = new Error('never connected');
	this.b_lasttime = null;
	this.b_queue = [];

	/* connection state */
	this.b_socket = null;
	this.b_connect_start = null;
	this.b_wait_start = null;
	this.b_connected = null;

	this.connect();
}

mod_util.inherits(StatsdBlaster, EventEmitter);

StatsdBlaster.prototype.warn = function (err)
{
	this.emit('warn', err);
};


/*
 * Stats interface
 */

StatsdBlaster.prototype.counter = function (basename, metadata, value)
{
	return (this.blast('counter', basename, metadata, value));
};

StatsdBlaster.prototype.gauge = function (basename, metadata, value)
{
	return (this.blast('gauge', basename, metadata, value));
};

StatsdBlaster.prototype.blast = function (type, basename, metadata, value)
{
	var self = this;
	var when = Date.now();
	var statname;

	if (type != 'counter' && type != 'gauge') {
		this.warn(new VError('unsupported stat type: "%s"', type));
		return;
	}

	if (!this.b_stats.hasOwnProperty(basename))
		return;

	this.b_stats[basename].forEach(function (statpattern) {
		statname = self.statname(statpattern, basename, metadata);
		if (statname instanceof Error)
			self.warn(statname);

		self.enqueue({
		    'type': type,
		    'statname': statname,
		    'value': value,
		    'timestamp': when
		});
	});

	if (this.b_state == BLASTER_S_NOMINAL)
		this.sendQueued();
};

StatsdBlaster.prototype.statname = function (statpattern, basename, metadata)
{
	/*
	 * This would be more efficient if we tokenized the statpattern once
	 * when we load the configuration.
	 */
	var statname, propname;
	var p, q, r;

	statname = '';
	q = 0;
	for (;;) {
		p = statpattern.indexOf('%', q);
		if (p == -1)
			break;

		if (p == statpattern.length - 1) {
			return (new VError('stat pattern "%s": expected ' +
			    'unexpected end of string', statpattern));
		}

		statname += statpattern.substr(q, p - q);
		if (statpattern.charAt(p + 1) == '%') {
			statname += '%';
			q = p + 2;
		}

		for (r = p + 1; r < statpattern.length &&
		    /[_a-zA-Z0-9]/.test(statpattern.charAt(r)); r++)
			continue;

		propname = statpattern.substr(p + 1, r - (p + 1));
		if (propname == '_name')
			statname += basename;
		else if (metadata.hasOwnProperty(propname))
			statname += metadata[propname].toString();
		else
			statname += 'undefined';
		q = r;
	}

	statname += statpattern.substr(q);
	return (statname);
};

StatsdBlaster.prototype.enqueue = function (point)
{
	/*
	 * Buffer only up to "maxqlen" data points.  See README.md.
	 */
	if (this.b_queue.length >= this.b_maxqlen)
		return;

	/*
	 * Buffer only up to "maxqmsecs" milliseconds' worth of data points.
	 * See README.md.
	 */
	if (this.b_queue.length > 0 &&
	    point.timestamp - this.b_queue[0].timestamp >= this.b_maxqmsecs) {
		return;
	}

	this.b_queue.push(point);
};

StatsdBlaster.prototype.sendQueued = function ()
{
	var tosend, serialized;

	while (this.nominal() && this.b_queue.length > 0) {
		tosend = this.b_queue.shift();
		serialized = this.statsdSerialize(tosend);
		this.b_socket.write(serialized);
	}
};

StatsdBlaster.prototype.statsdSerialize = function (point)
{
	if (point.type == 'counter')
		return (sprintf('%s:%s|c\n', point.statname, point.value));
	mod_assertplus.equal(point.type, 'gauge');
	return (sprintf('%s:%s|g\n', point.statname, point.value));
};


/*
 * Connection status interfaces
 */

StatsdBlaster.prototype.nominal = function ()
{
	return (this.b_state == BLASTER_S_NOMINAL);
};

StatsdBlaster.prototype.nconnects = function ()
{
	return (this.b_nconnects);
};

StatsdBlaster.prototype.nattempts = function ()
{
	return (this.b_nattempts);
};

StatsdBlaster.prototype.lastError = function ()
{
	return (this.b_error);
};

StatsdBlaster.prototype.lastWriteTime = function ()
{
	return (this.b_lasttime);
};

/*
 * TCP connection management
 */

StatsdBlaster.prototype.connect = function ()
{
	mod_assertplus.ok(this.b_socket === null);
	mod_assertplus.ok(this.b_connected === null);
	mod_assertplus.ok(this.b_connect_start === null);
	mod_assertplus.equal(this.b_state, BLASTER_S_NOTCONN);

	this.b_state = BLASTER_S_CONNECTING;
	this.b_connect_start = new Date();
	this.b_socket = mod_net.connect({
	    'port': this.b_port,
	    'host': this.b_host
	});

	this.b_socket.once('connect', this.b_onconnect);
	this.b_socket.once('error', this.b_onerror);
	this.b_socket.once('end', this.b_onend);
	this.b_nattempts++;
	/* TODO handle connection timeout */
};

StatsdBlaster.prototype.onSocketConnect = function ()
{
	mod_assertplus.equal(this.b_state, BLASTER_S_CONNECTING);
	mod_assertplus.ok(this.b_socket !== null);
	mod_assertplus.ok(this.b_connect_start !== null);
	mod_assertplus.ok(this.b_connected === null);

	this.b_state = BLASTER_S_NOMINAL;
	this.b_connected = new Date();
	this.b_nconnects++;
	this.b_error = null;
	this.emit('nominal');
	this.sendQueued();
};

StatsdBlaster.prototype.onSocketError = function (err)
{
	mod_assertplus.ok(this.b_state == BLASTER_S_NOMINAL ||
	    this.b_state == BLASTER_S_CONNECTING);
	this.onSocketDisconnect(new VError(err, 'socket error'));
};

StatsdBlaster.prototype.onSocketEnd = function ()
{
	mod_assertplus.equal(this.b_state, BLASTER_S_NOMINAL);
	this.onSocketDisconnect(new VError(
	    'server unexpectedly closed socket'));
};

StatsdBlaster.prototype.onSocketDisconnect = function (err)
{
	mod_assertplus.ok(this.b_socket !== null);
	this.b_socket.removeListener('connect', this.b_onconnect);
	this.b_socket.removeListener('error', this.b_onerror);
	this.b_socket.removeListener('end', this.b_onend);

	this.b_state = BLASTER_S_CONNWAIT;
	this.b_error = err;
	this.b_socket = null;
	this.b_connect_start = null;
	this.b_connected = null;
	this.b_wait_start = Date.now();
	this.emit('warn', err);

	setTimeout(this.onWaitTimeout.bind(this), 1000);
};

StatsdBlaster.prototype.onWaitTimeout = function ()
{
	mod_assertplus.equal(this.b_state, BLASTER_S_CONNWAIT);
	mod_assertplus.ok(this.b_socket === null);
	mod_assertplus.ok(this.b_wait_start !== null);

	this.b_wait_start = null;
	this.b_state = BLASTER_S_NOTCONN;
	this.connect();
};
