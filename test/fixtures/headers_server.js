var _, conf, express, fs, port, site;

_ = require('underscore');
fs = require('fs');
express = require('express');

site = express();

site.get('*', function(req, res) {
  fs.readFile('./test/fixtures/headers.html', 'utf8', function (err, data) {  
    if (err) throw err;
    var h_tmpl = _.template(data);
    res.write(h_tmpl({headers: req.headers}));
    res.end();
  });
});

port = 8000;

site.listen(port);

console.log("Listening on port " + port);
