var url     = require('url');
var fs      = require('fs');
var io      = require('socket.io');
var net     = require('net');
var crypto  = require('crypto');
var events  = require('events');
var params  = require('./params');
var funcs   = require('./functions');
var buffer  = require('./buffer');
var eventsG = require('./events');
var mylog   = funcs.mylog;
var initFinished = eventsG.initFinished;
var server;
var reconnectInterval;

if (params.useSSL)
{
   var https    = require('https');
   var options =
   {
      key: fs.readFileSync(params.sslcert.key),
      cert: fs.readFileSync(params.sslcert.cert),
      ciphers: params.cipher,
      honorCipherOrder: true
   };
   server = https.createServer(options);
}
else
{
   var http    = require('http');
   server  = http.createServer();
}

if (params.pathHTML)
{
   mylog('listen for http requests',0);

   server.on('request',function(request, response)
   {
      var path = url.parse(request.url).pathname;
      mylog('http request: ' + path,1);
      if (path === '/' || path === '')
      {
         path = '/' + params.indexHTML;
      }
      var htppFile = params.pathHTML + path;

      try
      {
         var HTML = fs.readFileSync(htppFile);
         response.writeHead(200, {'Content-Type': 'text/html'});
         response.write(HTML);
         response.end();
      }
      catch(e)
      {
         response.writeHead(404);
         response.write("Requested URL does not exist - 404");
         response.end();
      }
   });

}
else
{
   mylog('listen for http requests disabled',0);
   server.on('request',function(request, response)
   {
      var path = url.parse(request.url).pathname;
      mylog('illegal request for ' + path,0);
      response.writeHead(404);
      response.write(params.message404);
      response.end();
   });

}

var ios = io(server);

if (params.useClientPassword)
{
   var auth = require('socketio-auth');
   auth(ios,
   {
      authenticate: function (password, callback)
      {
         mylog("authentication by client",1);
         var connectionPassword = fs.readFileSync(params.connectionPasswordFile).toString().substr(0,64);
         if (crypto.createHash('sha256').update(password).digest('hex') === connectionPassword)
         {
            mylog("authentication success",1);
            return callback(null, true);
         }
         else
         {
            mylog("authentication failed",0);
            return callback(new Error("Invalid connection password"),false);
         }
      },
      timeout: 1000
   });
}

// handle for the websocket connection from client
ios.sockets.on('connection', function(socket)
{
/*   socket.emit('connected');
   var waitAuth = setTimeout(function ()
   {
      defListeners(socket);
   }, 3000);*/
   //emit authenticated if no passwd is used

   if (!params.useClientPassword)
   {
      mylog("emit authenticated",1);
      //clearTimeout(waitAuth);
      socket.emit('authenticated');
   }
   else
   {
      //clearTimeout(waitAuth);
   }
   defListeners(socket);
});

var defListeners = function(socket)
{
   mylog("client connected",0);
   socket.on('getValueOnce', function(data)
   {
      var jsonValue = buffer.checkValue(data);
      if (jsonValue)
      {
         mylog('get value for ' + data,2);
         mylog(jsonValue,2);
         socket.emit('value',jsonValue);
      }
   });

   socket.on('getValueOnChange', function(data)
   {
      mylog("request for getValueOnChange " + data,1);
      if(socket.rooms.indexOf(data) < 0)
      {
         socket.join(data);
      }
   });

   socket.on('getDeviceOnChange', function(data)
   {
      mylog("request for getDeviceOnChange " + data,1);
      if(socket.rooms.indexOf(data) < 0)
      {
         socket.join('device_' + data);
      }
   });

   socket.on('getAllValuesOnChange', function(data)
   {
      mylog("request for getAllValuesOnChange",1);
      if(socket.rooms.indexOf('all') < 0)
      {
         socket.join('all');
      }
   });

   socket.on('getAllDevicesOnChange', function(data)
   {
      mylog("request for getAllDevicesOnChange",1);
      if(socket.rooms.indexOf('devices_all') < 0)
      {
         socket.join('device_all');
      }
   });

   socket.on('getAllValues', function(callback)
   {
      mylog("request for getAllValues",1);
      if (!params.useClientPassword || socket.auth)
      {
         var response = buffer.checkValue('all');
         callback(response);
      }
      else
      {
         callback({error: 'not authenticated'});
      }
   });

   socket.on('command', function(cmd,callback)
   {
      // establish telnet connection to fhem server
      var fhemcmd = net.connect({port: params.fhemPort}, function()
      {
          fhemcmd.write(cmd + ';exit\r\n');
      });

      var answerStr = '';
      fhemcmd.on('data', function(response)
      {
         answerStr += response.toString();
      });

      fhemcmd.on('end', function()
      {
         var arrayResp = answerStr.split("\n");
         callback(arrayResp);
         fhemcmd.end();
         fhemcmd.destroy();
      });
      fhemcmd.on('error', function()
      {
         funcs.mylog('error: telnet connection failed',0);
      });
   });

   socket.on('getAllSwitches', function(callback)
   {
      mylog("allSwitches fired by client",1);
      var response = buffer.getAllSwitches();
      callback(response);
   });

   socket.on('getAllUnitsOf', function(type,callback)
   {
      var units = buffer.getAllUnitsOf(type);
      callback(units);
   });

   if (params.extendedMode)
   {
      socket.on('JsonList2', function(args,callback)
      {
         // establish telnet connection to fhem server
         mylog("request for JsonList2",1);
         var fhemcmd = net.connect({port: params.fhemPort}, function()
         {
             fhemcmd.write('JsonList2 ' + args + ';exit\r\n');
         });

         var answerStr = '';
         fhemcmd.on('data', function(response)
         {
            answerStr += response.toString().replace("\n","");
         });

         fhemcmd.on('end', function()
         {
            var startPos = answerStr.indexOf('{');
            var lastPos  = answerStr.lastIndexOf('}');
            answerStr = answerStr.substr(startPos,lastPos - startPos + 1);
            var answer = JSON.parse(answerStr);
            mylog(answer,2);
            callback(answer);
            fhemcmd.end();
            fhemcmd.destroy();
         });
         fhemcmd.on('error', function()
         {
            funcs.mylog('error: telnet connection failed',0);
         });
      });
   }

   socket.on('commandNoResp', function(data)
   {
      mylog("commandNoResp " + data,1);
      // establish telnet connection to fhem server
      var fhemcmd = net.connect({port: params.fhemPort}, function()
      {
         fhemcmd.write(data + '\r\n');
         fhemcmd.end();
         fhemcmd.destroy();
      });
      fhemcmd.on('error', function()
      {
         funcs.mylog('error: telnet connection failed',0);
         socket.emit('fhemError');
      });
   });

   socket.on('disconnect', function(data)
   {
       mylog('disconnected: ' + data);
       for (room in socket.rooms)
       {
          mylog("leave " + room,1);
          socket.leave(room);
       }
   });
};

initFinished.on('true',function()
{
   mylog('initFinished',1);
   server.listen(params.nodePort);
   connectFHEMserver();
});

function connectFHEMserver()
{
   funcs.mylog("start connection to fhem server",0);
   var trigger = net.connect({port: params.fhemPort}, function()
   {
      funcs.mylog('connected to fhem server for listen on changed values',0);
      trigger.write('inform on\r\n');
      ios.sockets.emit('fhemConn');
   });

   trigger.on('data', function(data)
   {
      mylog("changed data:",2);
      mylog(data.toString(),2);
      clearInterval(reconnectInterval);
      handleChangedValues(data.toString().split("\n"));
   });

   trigger.on('error', function()
   {
      mylog('error: telnet connection failed - retry in 10 secs',0);
      reconnectInterval = setTimeout(function ()
      {
         connectFHEMserver();
      }, 10000);
   });

   trigger.on('end', function()
   {
      funcs.mylog('error: telnet connection closed - try restart in 10 secs',0);
      reconnectInterval = setTimeout(function ()
      {
         connectFHEMserver();
      },10000);
   });
}

function getAllValues(type)
{
   // establish telnet connection to fhem server
   var fhemreq = net.connect({port: params.fhemPort}, function()
   {
      fhemreq.write('list;exit\r\n');
   });

   var answerStr = '';
   fhemreq.on('data', function(response)
   {
      answerStr += response.toString();
   });

   fhemreq.on('end', function()
   {
      buffer.readValues(answerStr);
      if (type === 'init')
      {
         initFinished.emit('true');
      }
      fhemreq.end();
      fhemreq.destroy();
   });

   fhemreq.on('error', function()
   {
      mylog('error: telnet connection for getting values failed - retry in 10 secs',0);
      setTimeout(function ()
      {
         getAllValues();
      }, 10000);
   });

}

function handleChangedValues(allLines)
{
   var devices = [];
   var device_old = '';
   allLines.forEach(function (line)
   {
      line = line.trim().split(' ');
      if (line.length > 1)
      {
         var device = line[1];
         if (device === 'global' && line.length > 3)
         {
            device = line[3];
         }
         if (line.length === 3)
         {
            buffer.setActValue(device,line[2]);
            var jsonValue = buffer.checkValue(device);
            ios.sockets.in(device).emit("value",jsonValue);
            ios.sockets.in("all").emit("value",jsonValue);
         }
         if (device_old !== device)
         {
            devices.push(device);
            device_old = device;
         }
      }
   });
   if (params.extendedMode)
   {
      for (var index in devices)
      {
         getDevice(devices[index]);
      }
   }
}

function getDevice(device)
{
   // establish telnet connection to fhem server
   mylog('get Jsonlist2 for device ' + device,1);
   var fhemreq = net.connect({port: params.fhemPort}, function()
   {
      fhemreq.write('JsonList2 ' + device + ';exit\r\n');
   });

   var answerStr = '';
   fhemreq.on('data', function(response)
   {
      answerStr += response.toString();
   });

   fhemreq.on('end', function()
   {
      mylog(answerStr,2);
      var startPos = answerStr.indexOf('{');
      var lastPos  = answerStr.lastIndexOf('}');
      answerStr = answerStr.substr(startPos,lastPos - startPos + 1);
      var deviceJSON = JSON.parse(answerStr);
      ios.sockets.in('device_all').emit('device',deviceJSON);
      ios.sockets.in('device_' + device).emit('device',deviceJSON);
      fhemreq.end();
      fhemreq.destroy();
   });

   fhemreq.on('error', function()
   {
      mylog('error: telnet connection for getting JsonList2 failed',0);
   });
}

function pollDBvalue(dbObj)
{
   setInterval(function()
   {
      readdb.getDBvalue(dbObj,net);
   }, dbObj.refresh * 1000);
}

// ----- Main -------------------

getAllValues('init');

setInterval(function()
{
   getAllValues('refresh');
},params.pollForAllDevices * 1000);

if (params.readDB)
{
   var readdb = require('./readdb');
   for (var i in params.readDBvalues)
   {
      var dbObj = params.readDBvalues[i];
      pollDBvalue(dbObj);
   }
}

var messSuff = (params.useSSL) ? 'with SSL' : 'without SSL';

mylog('Server started: ' + messSuff,0);