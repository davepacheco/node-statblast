#!/usr/sbin/dtrace -Zs

/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * statblast.d: trace counter and gauge updates processed by the "statblast"
 * module.
 */

#pragma D option quiet

BEGIN
{
	printf("%-6s %-7s %-5s %s\n", "PID", "TYPE",
	    "VALUE", "BASENAME/METADATA");
}

statblast*:::counter,
statblast*:::gauge
{
	printf("%6d %-7s %5d %s %s\n", pid, probename,
	    arg2, copyinstr(arg0), copyinstr(arg1));
}
