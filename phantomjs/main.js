/*
 * grunt-lib-phantomjs
 * http://gruntjs.com/
 *
 * Copyright (c) 2012 "Cowboy" Ben Alman, contributors
 * Licensed under the MIT license.
 */

/*global phantom:true*/

'use strict';

var fs = require('fs');
var system = require('system');
// The temporary file used for communications.
var tmpfile = system.args[1];
// The page .html file to load.
var url = system.args[2];
// Extra, optionally overridable stuff.
var options = JSON.parse(system.args[3] || {});
// load instrumented file data from the file/transport
var instrumentedFiles = {};
var useInstrumentedFiles = false;
if (options.transport && options.transport.coverage) {
  instrumentedFiles = JSON.parse(fs.read(options.transport.coverage));
  useInstrumentedFiles = true;
}

// Default options.
if (!options.timeout) { options.timeout = 5000; }

// Keep track of the last time a client message was sent.
var last = new Date();

// Messages are sent to the parent by appending them to the tempfile.
var sendMessage = function(arg) {
  var args = Array.isArray(arg) ? arg : [].slice.call(arguments);
  last = new Date();
  fs.write(tmpfile, JSON.stringify(args) + '\n', 'a');
};

// This allows grunt to abort if the PhantomJS version isn't adequate.
sendMessage('private', 'version', phantom.version);

// Create a new page.
var page = require('webpage').create(options.page);

// Abort if the page doesn't send any messages for a while.
setInterval(function() {
  if (new Date() - last > options.timeout) {
    sendMessage('fail.timeout');
    if (options.screenshot) {
      page.render(['page-at-timeout-', Date.now(), '.jpg'].join(''));
    }
    phantom.exit();
  }
}, 100);


// Inject bridge script into client page.
var injected;
var inject = function() {
  if (injected) { return; }
  // Inject client-side helper script.
  var scripts = Array.isArray(options.inject) ? options.inject : [options.inject];
  sendMessage('inject', options.inject);
  scripts.forEach(page.injectJs);
  injected = true;
};

// Keep track if the client-side helper script already has been injected.
page.onUrlChanged = function(newUrl) {
  injected = false;
  sendMessage('onUrlChanged', newUrl);
};

// The client page must send its messages via alert(jsonstring).
page.onAlert = function(str) {
  // The only thing that should ever alert "inject" is the custom event
  // handler this script adds to be executed on DOMContentLoaded.
  if (str === 'inject') {
    inject();
    return;
  }
  // Otherwise, parse the specified message string and send it back to grunt.
  // Unless there's a parse error. Then, complain.
  try {
    sendMessage(JSON.parse(str));
  } catch(err) {
    sendMessage('error.invalidJSON', str);
  }
};

// Relay console logging messages.
page.onConsoleMessage = function(message) {
  sendMessage('console', message);
};

// For debugging & coverage
page.onResourceRequested = function(request, networkRequest) {
  sendMessage('onResourceRequested', request);

  // check if we use code coverage is enabled
  if (!useInstrumentedFiles) { return; }

  // determine the protocol
  var isFile = request.url.search('file://') !== -1;
  var isHttp = request.url.search('http://') !== -1;
  var isHttps = request.url.search('https://') !== -1;
  var currentFile, content, prefix;

  // Phantom can not serve static content at this point.
  // So the file is stored in a temp dictionary and phantom is rerouted.
  // The name of the temp file is an escaped version of the original path.
  // The escaped path (id) is only used locally in this function.
  function changeContentHack(id, content) {
    var escaped = [/:/g, /\//g, /\\/g]; //may need more characters
    id = id.replace(/@/g, "@@");
    for(var i = 0; i < escaped.length; i++){
      id = id.replace(escaped[i], "@" + i + "_");
    }
    id = options.transport.instrumentedFiles + '/' + id;
    fs.write(id, content, 'w');
    networkRequest.changeUrl(prefix + id);
     if(isHttp || isHttps)
     {
       //get the hostname from the request object.
       var hostname = request.url.replace(prefix, '').split('/')[0];
       networkRequest.changeUrl(prefix + hostname + '/' + id); /*For HTML test files served by a web server (e.g., localhost),
                                                                 the change Url MUST include the hostname else the Url is unresolved
                                                                 which generates an error in PhantomJS.*/ 
     }else{
       networkRequest.changeUrl(prefix + id); 
     }
  }

  // process file based ressources
  if (isFile) {
    prefix = 'file://';
    currentFile = request.url.replace(prefix, '');
    currentFile = currentFile.replace(/%20/g, ' ');

    // check for query params (and thropw them away)
    if (currentFile.indexOf('?') > 0) {
      currentFile = currentFile.substr(0, currentFile.indexOf('?'));
    }

    if (!!instrumentedFiles[currentFile]) {
      content = instrumentedFiles[currentFile];
      changeContentHack(currentFile, content);
    }
  }

  // process http based ressources
  if (isHttp || isHttps) {
    prefix = isHttp ? 'http://' : 'https://';
    var undef;
    var temp = request.url.replace(prefix, '').split('/');
    temp.shift();
    currentFile = temp.join('/');
    if (!!instrumentedFiles[currentFile]) {
      content = instrumentedFiles[currentFile];
      if (options.transport.instrumentedFiles === undef) {
        options.transport.instrumentedFiles = 'temp';
      }

      try {
        changeContentHack(currentFile, content);
      } catch (e) {}
    }
  }
};

page.onResourceReceived = function(request) {
  if (request.stage === 'end') {
    sendMessage('onResourceReceived', request);
  }
};

page.onError = function(msg, trace) {
  sendMessage('error.onError', msg, trace);
};

phantom.onError = function(msg, trace) {
  sendMessage('error.onError', msg, trace);
};

// Run before the page is loaded.
page.onInitialized = function() {
  sendMessage('onInitialized');
  // Abort if there is no bridge to inject.
  if (!options.inject) { return; }
  // Tell the client that when DOMContentLoaded fires, it needs to tell this
  // script to inject the bridge. This should ensure that the bridge gets
  // injected before any other DOMContentLoaded or window.load event handler.
  page.evaluate(function() {
    /*jshint browser:true, devel:true */
    document.addEventListener('DOMContentLoaded', function() {
      alert('inject');
    }, false);
  });
};

// Run when the page has finished loading.
page.onLoadFinished = function(status) {
  // reset this handler to a no-op so further calls to onLoadFinished from iframes don't affect us
  page.onLoadFinished = function() { /* no-op */};

  // The window has loaded.
  sendMessage('onLoadFinished', status);
  if (status !== 'success') {
    // File loading failure.
    sendMessage('fail.load', url);
    if (options.screenshot) {
      page.render(['page-at-timeout-', Date.now(), '.jpg'].join(''));
    }
    phantom.exit();
  }
};

// Actually load url.
page.open(url);
