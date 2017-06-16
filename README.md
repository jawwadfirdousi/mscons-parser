# mscons parser

Description
===========

This app parses and identifies the MSCONS  files. MSCONS is an impletmentation of EDIFACT. They contain the power consumption data and are widely used in Europe for exchanging power consumption data.
This parser would only parse the 99a version of MSCONS.

Installation
============

All local dependencies can be installed with npm using

	% npm install

Configuring
===========
no configuration required

Running
=======

Run

	% node index  /etc/../../cons.mscons
absolute path as the first parameter. If MSCONS is valid the parsed file would be printed on console.
