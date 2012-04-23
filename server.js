var http = require('http'),
  https = require('https'),
  weekly = require('./lib/weekly'),
  config = require('./config/config'),
  dgram = require('dgram'),
  node_static = require('node-static'),
  sio = require('socket.io'),
  mongo = require('mongodb'),
  Hummingbird = require('./lib/hummingbird').Hummingbird;

var db = new mongo.Db('hummingbird', new mongo.Server(config.mongo_host, config.mongo_port, {}), {});

db.addListener("error", function (error) {
  console.log("Error connecting to mongo -- perhaps it isn't running?");
});

db.open(function (p_db) {
  var hummingbird = new Hummingbird();
  hummingbird.init(db, config, function () {
    var server;
    if (config.https) {
      server = https.createServer({'key': config.https_key, 'cert': config.https_cert});
    }
    else {
      server = http.createServer();
    }
    server.on('request',function (req, res) {
      try {
        hummingbird.serveRequest(req, res);
      } catch (e) {
        hummingbird.handleError(req, res, e);
      }
    });
    
    if (config.tracking_ip) {
      server.listen(config.tracking_port,config.tracking_ip);
    }
    else {
      server.listen(config.tracking_port);
    }
    console.log('Tracking server running at http'+(config.https? 's' : '')+'://'+(config.tracking_ip || '*')+':'+config.tracking_port+'/tracking_pixel.gif');

    if (config.enable_dashboard) {
      var file = new(node_static.Server)('./public');

      var dashboardServer;
      if (config.https) {
        dashboardServer = https.createServer({'key': config.https_key, 'cert': config.https_cert});
      }
      else {
        dashboardServer = http.createServer();
      }
      dashboardServer.on('request',function (request, response) {
        request.addListener('end', function () {
          file.serve(request, response);
        });
      });

      dashboardServer.listen(config.dashboard_port);
      console.log('Dashboard server running at http'+(config.https? 's' : '')+'://*:'+config.dashboard_port);
      console.log('Web Socket server running at ws://*:'+config.dashboard_port);
    } 
    else {
      console.log('Web Socket server running at ws://*:'+config.tracking_port);
    }
    
    var io = sio.listen(dashboardServer || server);

    io.set('log level', 2);

    hummingbird.io = io;
    hummingbird.addAllMetrics(io, db, config.metric_options);

    if (config.udp_address) {
      var udpServer = dgram.createSocket("udp4");

      udpServer.on("message", function (message, rinfo) {
        console.log("message from " + rinfo.address + " : " + rinfo.port);

        var data = JSON.parse(message);
        hummingbird.insertData(data);
      });

      udpServer.bind(config.udp_port, config.udp_address);

      console.log('UDP server running on UDP port ' + config.udp_port);
    }
  });
});
