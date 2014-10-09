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
var mod_statblast = require('statblast');
var blaster = mod_statblast.createBlaster({
    /* all arguments optional, but you almost certainly want statsd_stats */
    'backend': 'statsd',

    'statsd_mode': 'tcp',
    'statsd_host': '127.0.0.1',
    'statsd_port': 8125,

    /*
     * Queue up to 2 seconds' worth of data or 500 datapoints (whichever is
     * smaller) before dropping if needed.
     */
    'statsd_queue_npoints': 1000,

    /*
     * With this configuration, statblast creates two families of stats.
     * The values of %_name, %host, and %method come from metadata supplied
     * each time you emit the stat.
     */
    'statsd_stats': {
        'myapp.requests': [
	    '%_name.%host',
	    '%_name.%method'
	]
    }
});

/*
 * This sends two values to statsd:
 *
 *    myapp.requests.host001    5
 *    myapp.requests.GET        5
 *
 * These are driven by the configuration above.
 */
blaster.counter('myapp.requests', {
    'host': require('os').hostname(),
    'method': 'GET'
}, 1);

/*
 * Ditto, but with a gauge.
 */
blaster.gauge('myapp.concurrent_requests', {
    'host': require('os').hostname()
}, 1);
```

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
gets more unwieldy the more metadata fields you have.


## Statblast

statblast is a client library for sending statsd-like stats with additional
metadata.  It doesn't solve the problems described above, where metadata encoded
in the stat name becomes unwieldy as you add more kinds of metadata.  What it
does today is provide an interface for recording stat data that *could* support
a richer backend in the future.

You use statblast by creating a Blaster, configured as shown in the synopsis
above.  Currently, only the TCP-based statsd backend is supported.  The basic
method used on the blaster is:

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
        '%_name.%host',
        '%_name.%method'
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
ignores it.  You can reconfigure your app to determine what you want to be
sending and not, but the app code can always just call into statblast.


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
  operating normally.  Normally this means that there's an open TCP connection
  to the downstream statsd server and data is flowing.  However, if there are no
  stats configured, then nominal() will return true even if the TCP connection
  doesn't exist.
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
