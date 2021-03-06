var sys = require('util'),
  fs = require('fs'),
  config = require('../config/config'),
  View = require('./view').View,
  Metric = require('./metric').Metric,
  Buffer = require('buffer').Buffer,
  arrays = require('./arrays'),
  querystring = require('querystring');


var Hummingbird = function(db, callback) {
  var pixelData = fs.readFileSync(__dirname + "/../images/tracking.gif", 'binary');
  this.pixel = new Buffer(43);
  this.pixel.write(pixelData, 'binary', 0);

  this.metrics = [];
};

Hummingbird.prototype = {
  init: function(db, options, callback) {
    var defaults = {
      'visits_collection': 'visits',
      'visits_collection_options': {},
      'ip_blacklist' : []
    };
    this.options = defaults;
    for(var o in defaults) {
      if(typeof options[o] != "undefined") this.options[o] = options[o];
    }

    this.setupDb(db, function() {
      callback();
    });
  },

  setupDb: function(db, callback) {
    var self = this;

    db.createCollection(self.options.visits_collection, this.options.visits_collection_options, function(err, collection) {
      db.collection(self.options.visits_collection, function(err, collection) {
        self.collection = collection;
        callback();
      });
    });
  },

  addAllMetrics: function(io, db, options) {
    var self = this;

    Metric.allMetrics(function(metric) {
      metric.init(db, options);
      metric.io = io;
      metric.io.sockets.on('connection',function(socket) {
        socket.on('past data '+metric.name,function(num, time_unit, callback) {
          metric.getPastData(num, time_unit, callback);
        });
      });
      self.metrics.push(metric);
    });
  },

  serveRequest: function(req, res) {
    this.writePixel(res);

    var env = this.splitQuery(req.url.split('?')[1]);
    env.ip = env.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    //don't count the tracking pixel if the ip is in the blacklist
    if(this.options.ip_blacklist.indexOf(env.ip) != -1) return;

    this.insertData(env);
  },

  insertData: function(env) {
    env.timestamp = env.timestamp || new Date();
    var view = new View(env);

    this.collection.insertAll([view.env]);

    for(var i = 0; i < this.metrics.length; i++) {
      this.metrics[i].incrementCallback(view);
      this.metrics[i].isDirty = true;
    }
  },

  splitQuery: function(query) {
    var queryString = {};
    (query || "").replace(
      new RegExp("([^?=&]+)(=([^&]*))?", "g"),
      function($0, $1, $2, $3) { queryString[$1] = querystring.unescape($3.replace(/\+/g, ' ')); }
    );

    return queryString;
  },

  writePixel: function(res) {
    res.writeHead(200, { 'Content-Type': 'image/gif',
                         'Content-Disposition': 'inline',
                         'Content-Length': '43' });
    res.end(this.pixel);
  },

  handleError: function(req, res, e) {
    res.writeHead(500, {});
    res.write("Server error");
    res.end();

    e.stack = e.stack.split('\n');
    e.url = req.url;
    sys.log(JSON.stringify(e, null, 2));
  }
};

exports.Hummingbird = Hummingbird;
