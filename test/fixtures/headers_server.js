var _ = require('lodash');
var fs = require('fs');
var express = require('express'); 
var port = 8000;
var site = express();

site.get('*', function(req, res) {
  fs.readFile('./test/fixtures/headers.html', 'utf8', function (err, data) {  
    if (err) throw err;
    var h_tmpl = _.template(data);
    res.write(h_tmpl({headers: req.headers}));
    res.end();
  });
});

site.listen(port);

console.log('Listening on port ' + port);
