var fs = require('fs');
var express = require('express');
var port = 8075;
var site = express();

site.get('*', function(req, res) {
  fs.readFile('./test/fixtures/headers.html', 'utf8', function (err, data) {
    if (err) {
        throw err;
    }
    var tmpl = data.replace(/<% headers %>/, JSON.stringify(req.headers));
    res.write(tmpl);
    res.end();
  });
});

site.listen(port);

console.log('Listening on port ' + port);
