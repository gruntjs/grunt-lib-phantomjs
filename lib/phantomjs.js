/*
 * grunt-lib-phantomjs
 * http://gruntjs.com/
 *
 * Copyright (c) 2016 "Cowboy" Ben Alman, contributors
 * Licensed under the MIT license.
 */

'use strict';

exports.init = function(grunt) {

  // Nodejs libs.
  var path = require('path');

  // External libs.
  var semver = require('semver');
  var WebSocketServer = require('ws').Server;
  var EventEmitter2 = require('eventemitter2').EventEmitter2;

  // Get path to phantomjs binary
  var binPath = require('phantomjs-prebuilt').path;

  // The module to be exported is an event emitter.
  var exports = new EventEmitter2({wildcard: true, maxListeners: 0});

  // Get an asset file, local to the root of the project.
  var asset = path.join.bind(null, __dirname, '..');

  // Call this when everything has finished successfully... or when something
  // horrible happens, and you need to clean up and abort.
  var wss;
  exports.halt = function() {
    if (wss) {
      wss.close();
      wss = undefined;
    }
  };

  // Start PhantomJS process.
  exports.spawn = function(pageUrl, options) {
    // Handle for spawned process.
    var phantomJSHandle;
    // Default options.
    if (typeof options.killTimeout !== 'number') { options.killTimeout = 1000; }
    options.options = options.options || {};

    // All done? Clean up!
    var cleanup = function(done, immediate) {
      var kill = function() {
        // Only kill process if it has a pid, otherwise an error would be thrown.
        if (phantomJSHandle.pid) {
          phantomJSHandle.kill();
        }

        if (typeof done === 'function') { done(null); }
      };
      // Allow immediate killing in an error condition.
      if (immediate) { return kill(); }
      // Wait until the timeout expires to kill the process, so it can clean up.
      setTimeout(kill, options.killTimeout);
    };

    // Internal methods.
    var privates = {
      // Abort if PhantomJS version isn't adequate.
      version: function(version) {
        var current = [version.major, version.minor, version.patch].join('.');
        var required = '>= 1.6.0';
        if (!semver.satisfies(current, required)) {
          exports.halt();
          grunt.log.writeln();
          grunt.log.errorlns(
            'In order for this task to work properly, PhantomJS version ' +
            required + ' must be installed, but version ' + current +
            ' was detected.'
          );
          grunt.warn('The correct version of PhantomJS needs to be installed.', 127);
        }
      }
    };

    wss = new WebSocketServer({path: '/phantomjs', port: 4000});

    function ab2str(buf) {
      var str = String.fromCharCode.apply(null, new Uint16Array(buf));
      return str.replace(/\0/g, '');
    }

    wss.on('connection', function(ws) {
      ws.on('message', function(data) {
        // Get args and method.
        var args = JSON.parse(ab2str(data));
        var eventName = args[0];
        // Debugging messages.
        grunt.log.debug(JSON.stringify(['phantomjs'].concat(args)).magenta);

        if (eventName === 'private') {
          // If a private (internal) message is passed, execute the
          // corresponding method.
          privates[args[1]].apply(null, args.slice(2));
        } else {
          // Otherwise, emit the event with its arguments.
          exports.emit.apply(exports, args);
        }
      });
      ws.on('close', function() {
        // All done.
        cleanup(options.done);
      });
    });

    // Process options.
    var failCode = options.failCode || 0;

    // An array of optional PhantomJS --args.
    var args = [];
    // Additional options for the PhantomJS main.js script.
    var opts = {};

    // Build args array / opts object.
    Object.keys(options.options).forEach(function(key) {
      if (/^\-\-/.test(key)) {
        args.push(key + '=' + options.options[key]);
      } else {
        opts[key] = options.options[key];
      }
    });

    // Keep -- PhantomJS args first, followed by grunt-specific args.
    args.push(
      // The main PhantomJS script file.
      opts.phantomScript || asset('phantomjs/main.js'),
      // URL or path to the page .html test file to run.
      pageUrl,
      // Additional PhantomJS options.
      JSON.stringify(opts)
    );

    grunt.log.debug(JSON.stringify(args));

    // Actually spawn PhantomJS.
    return phantomJSHandle = grunt.util.spawn({
      cmd: binPath,
      args: args
    }, function(err, result, code) {
      if (!err) { return; }

      // Ignore intentional cleanup.
      if (code === 15 || code === null /* SIGTERM */) { return; }

      // If we're here, something went horribly wrong.
      cleanup(null, true /* immediate */);
      grunt.verbose.or.writeln();
      grunt.log.write('PhantomJS threw an error:').error();
      // Print result to stderr because sometimes the 127 code means that a shared library is missing
      String(result).split('\n').forEach(grunt.log.error, grunt.log);
      if (code === 127) {
        grunt.log.errorlns(
          'In order for this task to work properly, PhantomJS must be installed locally via NPM. ' +
          'If you\'re seeing this message, generally that means the NPM install has failed. ' +
          'Please submit an issue providing as much detail as possible at: ' +
          'https://github.com/gruntjs/grunt-lib-phantomjs/issues'
        );
        grunt.warn('PhantomJS not found.', failCode);
      } else {
        grunt.warn('PhantomJS exited unexpectedly with exit code ' + code + '.', failCode);
      }
      options.done(code);
    });
  };

  return exports;
};
