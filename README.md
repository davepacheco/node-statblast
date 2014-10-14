<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# node-statblast: send statsd-like metric data

This README is aspirational!  None of this exists yet.


## Synopsis

```javascript
var mod_assert = require('assert');
var mod_os = require('os');
var mod_statblast = require('statblast');

var hostname = mod_os.hostname().replaceAll(/\.*/g);
var blaster = mod_statblast.createBlaster({
    /* all arguments optional, but you almost certainly want statsd_stats */
    'backend': 'statsd',

    'statsd_mode': 'udp',
    'statsd_host': '127.0.0.1',
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
	    'host': mod_os.hostname(),
	    'method': 'GET'
	}, 1);
	
	/*
	 * Ditto, but with a gauge.
	 */
	blaster.gauge('myapp.concurrent_requests', {
	    'host': mod_os.hostname()
	}, 1);
}, 1000);
```

## Quick start using Docker

1. Set up the [kamon-io Statsd + Graphite +
   Grafana](https://github.com/kamon-io/docker-grafana-graphite) Docker image.
   This should be just a "docker pull" plus a "docker run" that exposes at least
   the statsd UDP port and Grafana HTTP port.

1. Clone this repo:

        $ git clone https://github.com/davepacheco/node-statblaster
        $ cd node-statblaster

1. Set the STATBLAST\_HOST environment variable to the IP of your Docker host.
   If you're using boot2docker to run Docker, you can get this IP with
   `boot2docker ip`.

        $ export STATBLAST_HOST=192.168.59.103

1. Start the demo statblast emitter:

        $ node examples/synth.js

   The demo won't emit anything as long it's emitting data normally.

1. Open up Grafana.  You would normally access this by pointing your browser at
   the same IP you set STATBLAST\_HOST to.

1. Using the Grafana UI, add a new query for the Graphite expression:

        sumSeries(stats.counters.myapp.requests.byhost.*.count)


## Background

### Statsd

[statsd](https://github.com/etsy/statsd/) is a collector for metric data (e.g.,
performance counters, timers, and the like).  It aggregates this data and ships
it to some metric storage backend like
[graphite](http://graphite.readthedocs.org/).  Stats are described using
dot-delimited names.  You might use a stat name like this to represent the total
number of requests to your app's frontend:

    myapp.frontend.nrequests

There are a few different types of stat in graphite, like counters (whose values
are added together), gauges (where subsequent values replace previous ones), and
timers (whose values are bucketed like a histogram).  Stat names are not
predefined anywhere.  Applications just start sending values tagged with a stat
name and stat type, and statsd and graphite auto-create them as needed.  This
makes it quite easy to add new metrics to deployed software.

### Stat metadata

When you want to add metadata to these stats, the pattern is to include that
metadata in the stat name.  So if you want a count of requests by *instance
name* (i.e., hostname), you might send these stats instead of the one above:

    myapp.frontend.nrequests.host001
    myapp.frontend.nrequests.host002
    myapp.frontend.nrequests.host003

When you fetch this data out (i.e., for a dashboard), graphite supports queries
like:

    groupByNode(myapp.frontend.nrequests.*, 4, "sumSeries")

which would produce a single graph with three lines, one for each host, or:

    sumSeries(myapp.frontend.nrequests.*)

which would produce one graph with the sum of all requests.

You can do this with more metadata, too.  For example, you could have stats
tracking the hostname, request type, and response code:

    myapp.frontend.nrequests.host001.GET.200

which would allow you to plot graphs of total requests, requests by hostname,
requests by status code, requests by method, and so on.  Not surprisingly, this
gets more unwieldy the more metadata fields you have, and it doesn't work well
if metadata fields would include dots (e.g., hostnames).


## Statblast

statblast is a client library for sending statsd-like stats with additional
metadata.  It doesn't solve the problems described above, where metadata encoded
in the stat name becomes unwieldy as you add more kinds of metadata.  What it
does today is provide an interface for recording stat data that *could* support
a richer backend in the future.

You use statblast by creating a Blaster, configured as shown in the synopsis
above.  The basic method used on the blaster is:

```javascript
blaster.blast(type, basename, metadata, value);
```

Here:

* `type` is the statsd type for this metric: `counter` or `gauge`.
* `basename` is the name for a family of related stats.  As an example,
  "myapp.requests" would be a useful basename for stats that include total
  requests, requests by host, and requests by method.
* `metadata` is an object with key-value pairs.
* `value` is the update you want to apply for this metric.  The meaning of this
  depends on the type.  For counters, the value is added to the current value of
  this stat.  For gauges, the value replaces the current value of the stat.

For the statsd backend (the only backend currently supported), this uses the
Blaster's configuration to send zero or more statsd data points to the blaster.
The `basename` is looked up in the `statsd_stats` config object.  If present and
an array, then each entry in that array will produce a new statsd value whose
stat name is constructed by expanding the metadata key-value pairs.  For
example, in the configuration:

```javascript
'statsd_stats': {
    'myapp.requests': [
        '%_name.byhost.%host',
        '%_name.bymethod.%method'
    ]
}
```

when you call:

```javascript
blaster.blast('counter', 'myapp.requests', {
    'host': 'host001',
    'method': 'GET'
}, 10);
```

This produces two statsd datapoints:

    myapp.requests.host001
    myapp.requests.GET

both with value 5.  These names come from expanding metadata values in the
strings (identified with '%').  The expansion '%%' expands to a literal '%', and
the expansion '%\_name' expands to the basename.

If you blast a stat that's not defined in the configuration, statblast just
ignores it.  The idea is that your app can record whatever it wants and you can
reconfigure statblast to filter out only the events you want to send.


## Error handling

For most applications, metric systems are best-effort.  They should be as
available as possible, but if they go down, they should not bring down the
service they're monitoring.  As a result, statblast generally doesn't emit
errors once it's correctly configured.  (That is, it may emit configuration
validation errors, but it won't emit errors as a result of network connectivity
problems, unknown stats being emitted, or the like.)

That said, it's useful to be able to tell the status of statblast's downstream
connection.  There are a few status methods on the blaster:

* `nominal()`: returns a boolean indicating whether all downstream backends are
  operating normally.  In TCP mode, this means that there's an open TCP
  connection to the downstream statsd server and data is flowing.  However, if
  there are no stats configured, then nominal() will return true even if the TCP
  connection doesn't exist.
* `nconnects()`: returns the number of successful TCP connections (indicates
  roughly how many times connectivity to the server has been lost)
* `nattempts()`: returns the number of TCP connect attempts (both successful and
  failed) that have been started
* `lastWriteTime()`: returns the timestamp before which all data has been
  transmitted successfully, or null if data has not been transmitted.  This is
  useful for understanding the last time 
* `lastError()`: if nominal() would return true, this returns null.  If
  nominal() returns false, then this returns an Error object describing what's
  wrong.  This is normally what would be emitted as an `error` event, except
  that for the reasons described above we don't consider this a fatal error.
* `nqueued()`: number of data points queued (because of a previous disconnect)
* `ndropped()`: number of data points dropped (because the queue overflowed)

Additionally, events are emitted to indicate state changes:

* `nominal`: status was not previously okay, but is now (see nominal() above)
* `warn`: status was previously okay, but is not now.  Argument includes the
  Error object that would be returned by `lastError()`.

### Queueing data during transient failures

On the one hand, it would be nice if when the stat collector (e.g., statsd) goes
down, data is not lost during that period.  statblast could queue data points
locally until statsd comes back, but there are several problems with this:

* If statsd is down for an extended period or while application activity is
  high, an unbounded amount of memory could be used, eventually running your
  program out of memory.
* There's a [thundering herd
  problem](http://en.wikipedia.org/wiki/Thundering_herd_problem) when the
  collector comes back up and all of the data sources transmit their queued
  data points.  With a naive approach, if the sources are producing N data
  points per second, and the collector is down for M seconds, then the collector
  may end up seeing M times the initial load for several seconds!  This is
  particularly bad when the collector went down due to excessive load in the
  first place.  It can be very difficult to recover a system from this state.
* The statsd protocol does not provide timestamps.  Timestamps are inferred at
  the collector, not recorded at the source.  So while you could alleviate the
  thundering herd problem by throttling the number of queued data points sent
  per second, the result would appear wrong because the metric system would make
  it look like some events happened over a longer period that may have happened
  all at once.  Plus, you'd be forced to choose between sending data in order,
  in which case real-time data would be queued until all queued data has been
  sent, or sending data out-of-order, indicating that some events happened in a
  different order than they actually did.

As a compromise, statblast queues data for up to two seconds by default: this is
short enough that it's unlikely to accumulate much extra data than normal, and
data won't appear too far from when it actually happened in time, but it's long
enough to survive transient statsd failures.


### Example

To make this concrete:

* When you initialize the blaster with at least one stat, `nominal()` returns
  `false`, `nconnects()` returns 0, `nattempts` returns 1, `lastWriteTime()`
  returns `null`, `lastError()` returns an error indicating that we're
  disconnected, and `queued()` returns 0.
* When the blaster initially connects to the downstream statsd server, `nominal`
  is emitted, `nominal()` returns true, `nconnects()` returns 1,
  `lastWriteTime()` returns a timestamp around when the connection was created,
  `lastError()` returns `null`, and `queued()` returns 0.
* Suppose the statsd server goes down.  `warn` is emitted, `nominal()` returns
  false, `lastError()` returns an Error describing what happened, and
  `lastWriteTime()` returns a timestamp shortly before the disconnect.  As
  statblast tries to reconnect, the value returned by `nattempts()` increases.
  `lastWriteTime()` and `lastError()` will not change until a reconnect
  completes successfully.  As the app continues to emit data points, the value
  returned by `nqueued()` increases until the queue overflows, at which point
  `ndropped()` starts increasing.
* Suppose the statsd server is brought back up.  When statblast finally
  reconnects, `nominal` is emitted, `nconnects()` increases by one, `nominal()`
  returns true, `lastError()` returns null, and queued data points are
  transmitted downstream.  `nqueued()` should decrease to 0, and
  `lastWriteTime()` will increase to slowly reach the current time.


## Inspecting statblast with DTrace

On systems with DTrace support, statblast provides DTrace probes that fire
whenever any counter or gauge is updated.  The included statblast.d script
prints out all counters and gauges being updated on the system.  As an example,
run the demo above, and then in a separate terminal, run:

    $ sudo ./bin/statblast.d 
    PID    TYPE    VALUE BASENAME/METADATA
     70542 counter     1 myapp.requests {"host":"sharptooth","method":"GET"}
     70542 counter     1 myapp.requests {"host":"sharptooth","method":"GET"}
     70542 counter     1 myapp.requests {"host":"sharptooth","method":"GET"}
     70542 counter     1 myapp.requests {"host":"sharptooth","method":"GET"}

The script runs until you kill it.  Each time a counter or gauge is updated, it
prints the pid that updated it, the type of stat (counter or gauge), the value,
and the basename and metadata (see above).


## Sending data from the command line

There are lots of programs that emit periodic numeric output, and for
prototyping it's often useful to transmit data directly from these programs.
For example, on systems with DTrace support, this command prints the number of
system calls per second across the whole system:

    $ dtrace -q -n 'syscall:::{ @ = count(); }' \
        -n 'tick-1s{ printa(@); clear(@); }'

            12290

            10027

            11926

            11157

This package provides statblast(1), a command-line tool for transmitting data.
You could ingest this system call data directly into statsd using:

    $ dtrace -q -n 'syscall:::{ @ = count(); }' \
        -n 'tick-1s{ printa(@); trunc(@); }' | \
        statblast --global-metadata="host=$(hostname)" \
            --statsd-host=... \
	    --statsd-stats=myapp.syscalls.%host \
	    myapp.syscalls

statblast reads the piped data and treats each blank line like a call to
the Node.js `.blast` function above.  The default type is "counter" (use
--type=gauge for a gauge).  "myapp.syscalls" is the basename.  The other flags
correspond to the configuration options for creating a blaster.  Global metadata
are a list of key-value pairs that should be supplied for all data points.

You can also ingest data that has metadata for each point.  For example, this
similar script emits data points not just for each second, but also for each
syscall:

    $ dtrace -q -n 'syscall:::{ @[probefunc] = count(); }' \
          -n 'tick-1s{ printa(@); trunc(@); }'

      ...
      workq_kernreturn                                                 75
      __semwait_signal                                                 79
      sendmsg                                                          98
      write                                                           124
      read                                                            174
      recvmsg                                                         192
      psynch_cvwait                                                   374
      kevent                                                          570
      ioctl                                                          8315

Here's a one-liner that transmits this data and includes the system call name
(e.g., "ioctl") as stat metadata (that, with the statsd target, gets
incorporated into the stat name):

    $ dtrace -q -n 'syscall:::{ @[probefunc] = count(); }' \
          -n 'tick-1s{ printa(@); trunc(@); }' \
        statblast --global-metadata="host=$(hostname)" \
            --statsd-host=... \
	    --statsd-stats=myapp.syscalls.%host \
	    --statsd-stats=myapp.syscalls.%syscall \
	    --format=syscall,value \
	    myapp.syscalls

Here's a duct-tape one-liner for OS X that transmits IOPS for this host:

    $ iostat 1 | statblast --format=-,value
        --global-metadata=host=$(hostname) \
	--statsd-stat=myapp.iops.%host \
	myapp.iops
