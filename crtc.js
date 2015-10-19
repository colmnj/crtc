/*
Colm Quinn 2015

Node.js webrtc signalling websocket server

Prereqistics:
   1.  A server certificate.  see crtc_tls_setup.txt
           key: fs.readFileSync('rtc-private-key.pem'),
           certificate: fs.readFileSync('rtccq-public-cert.pem'),
   2.  The following node.js packages:  ws, collections, fs, path, http, httpdispatcher
   
*/

// Log level
var debug_all   = 255;
var debug_ice   = 128;
var debug_ws    = 128;
var debug_http  = 64;
var log_ws      = 32;
var log_http    = 16;
var log8        =  8;  // available
var log_pong    =  4
var log_trace   =  2;
var log_min     =  1;

var LOG_TRACE = debug_all;
var LOG_INFO  = log_ws + log_http;
var LOG_DEBUG = LOG_INFO + debug_ice + debug_http + debug_ws;

// nttp response codes
var http500 = 500;
var http404 = 404;
var http400 = 400;
var http200 = 200;

//var LOG = log_min + debug_http + log_http +log_trace; //log_min;   
var LOG = log_min + log_ws + debug_ws; 

var httpport = 1230;

var WebSocketServer = require('ws').Server;
var http      = require('https');
var url       = require('url');
var querystring = require('querystring');
var dispatcher = require('httpdispatcher');
var Dict      = require("collections/dict");
var FastMap   = require("collections/fast-map");
var fs        = require("fs");
var path      = require("path");
var util      = require('util');
var jsonic    = require('jsonic');
var log4js    = require('log4js');

var validation = require('./validate.js');

var webDirectory = __dirname + "/web";


var contentTypesByExtension = {
		'.html': "text/html",
		'.css':  "text/css",
		'.js':   "text/javascript"
	};
	
var defaultHtml = "<html><header></header><body>Default Gateway Page</body></html>";	
var errorHtml = "<html><header></header><body>Default Gateway Error. An unexpected error has occured</body></html>";	


var l4jslogging;	
var log4jscfgfile;
var logname = "CRTC";
	
	
var key = null;
var value = null;	


// parse parameters
// ----------------
process.argv.forEach(function (parameter, index, array) {

	if (parameter === '-h' || parameter === '-help') {
		console.log("\nUsage:\n     node crtc.js { -port xxxx =loglevel xxxx -log4jcfg xxxxx -logname xxxx }");
        console.log("\n" +
					"    -port:        port for http and websocket connections (default 1230)\n" +
					"    -web          directory for html/js content" +
					"    -logelevel:   (see below)\n" +
					"    -log4jcdf:    log4js json configuration file\n" +
					"    -logname:     name to give to this log (useful if running multiple instances)\n" +
					" \n  Default log level will be 48 (log_ws+log_http). If no log4js config is supplied crtc will log to the console\n" +
		            " \n\n  loglevel settings (can be added):\n" +
		            "loglevel settings:\ndebug_all=255\ndebug_ice=128\ndebug_ws=128\ndebug_http=64\n" +
                    "log_ws=32\nlog_http=16\nlog_pong=4\nlog_trace=2\nlog_min=1"
		           );
	    process.exit();			   
	}
	if ( startsWith(parameter, '-' ) ) {
       	key = parameter;
	}
	else {
		if (parameter != null) {
			if (key === '-port') {
				httpport = parseInt(parameter);
			}
			else if (key === '-loglevel') {
				LOG = parseInt(parameter);
			}
            else if (key === '-log4jscfg') {
				log4jscfgfile = parameter;
			}
			else if (key === '-logname') {
				logname = parameter;
			}
			else if (key === '-web') {
				webDirectory = __dirname + "/" + parameter;
			}
		}
	}
});	


//Set up logs directory if missing
//--------------------------------
try {
  require('fs').mkdirSync('./logs');
} 
catch (e) {
  if (e.code != 'EEXIST') {
    console.log("Could not set up log directory, error was: ", e);
    process.exit();
  }
}

// set up ctrl-c handling
// ----------------------
if (process.platform === "win32") {
  var rl = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on("SIGINT", function () {
    process.emit("SIGINT");
  });
}

process.on("SIGINT", function () {
   //graceful shutdown - flush log4j logs
   if (typeof crtclog != 'undefined') {
	   crtclog.info("Shutting down");
      log4js.shutdown(function() { process.exit(); });
   }
   else {
	  console.log("CRTC Shutting down");
	  process.exit();
   }
});

// Configure log4js if required
// ----------------------------
if (typeof log4jscfgfile != 'undefined') {
	log4js.configure(log4jscfgfile, {} );
}
var crtclog = log4js.getLogger(logname);
crtclog.setLevel("TRACE");



crtclog.info("Server Startup");

	
// tls setup
// ---------
var options = {
  key: fs.readFileSync('rtc-private-key.pem'),
  cert: fs.readFileSync('rtccq-public-cert.pem')
};	


// HTTP Server
// ============
var httpsserver = http.createServer(options, function(request, response) {

	if (LOG & debug_http) {
	   crtclog.info("\nHTTP:----\n");
	   crtclog.info(request.headers);
	   crtclog.info("--\n\n");
	}
	var thishost = request.headers['host'];
	var thisusername;
	var portix = thishost.indexOf(":");
	if (portix > -1) {
		thishost = thishost.substring(0, portix);
	}

	var requestUrl = url.parse(request.url);
    var fsPath = webDirectory+requestUrl.pathname;
	
	if (LOG & log_http) {
	   crtclog.info("HTTP: request received: " + request.url + "  method " +request.method);
	   crtclog.info("HTTP: Filename :" +fsPath);
	}	

	if (request.method === "GET" ) {
		fs.exists(fsPath, function(exists) {
			try {
				if (exists) {
					var headers = {};
					var contentType = contentTypesByExtension[path.extname(fsPath)];
					fs.readFile(fsPath, 'binary', function(err, content) {	
						var headers = {};
						var contentType = contentTypesByExtension[path.extname(fsPath)];
 		   
						if (LOG & log_http) {
							crtclog.info("HTTP: "+fsPath+"   Content-Type:" + contentType); 
						}						
						response.writeHead(200,{'Content-Length':content.length, 'Content-Type':contentType});
						var sent = response.write(content, 'utf8', function(err) {
							if (err) {
								crtclog.info("HTTP: Error onwrite: " +err);
							}
							if (LOG & log_http) {
								crtclog.info("HTTP: write endcallback: response written");
							}					   
							response.end();
						});			 
						//crtclog.info("post write " + sent);
						return;
					}); 
				}  // exists ??
				else {
					response.writeHeader(404);
					response.end(missingHtml);
					return;
				}
			}
			catch(e) {
				httpsenderror(http500, response);
				return;
			}
		});
	}
	else if (request.method === "POST") {
		// TODO
	}
    return;	
}).listen(parseInt(httpport, 10));

function httpsenderror(code, response) {
	if (LOG & log_trace) {
		crtclog.info("HTTP: httpsenderror " + code);
	}
	response.writeHead(code);
    response.end(errorHtml);
}




// =================
// websocket server
// =================
//var wss = new WebSocketServer({host: '0.0.0.0', port: wsport});
var wss = new WebSocketServer( {server: httpsserver });
crtclog.info('server active : port ' +httpport +' loglevel ' +LOG);

var clientids = [];            // all active clients
var unions    = [];
var reuseids  = [];            // all ids (array slots) available for reuse
var registrations = [];        // id -> userid

// maps
var registrar = new Dict(null, function (key) {  // userid->id
    return "unknown";
});

var connections = new FastMap();            // id->connection (type)
var wSockets = new FastMap();               // id->websocket
var sessions = new FastMap();               // sessionid->session

var connectionid = 0;           // incrementing connectionid

// websocket logic
// ===============
wss.on('connection', function(ws) {


  var id = -1;
  if (reuseids.length > 0) {
	  id = reuseids.shift();
	  unions[id] = -1;
  }
  else {
	  id = ++connectionid;
	  unions[id] = -1;
  }
  if (LOG & log_ws) {
     crtclog.info('WS: new connection.  Id=' + connectionid);
  }  
  
  // set up keepalive
  // -----------------
   ws.pingssent = 0;
   var timer = setInterval(function() {
      if (ws.pingssent >= 2) {  // how many missed pings you will tolerate before assuming connection broken.
		var closeid = wSockets.get(ws);
		var connection = connections.get(closeid);  
		crtclog.info("PING:  TIMEOUT id [%d]", closeid);  
		var connection = connections.get(closeid);
		clearInterval(connection.timerid);
		reuseids.push(closeid);
		registrar.delete(connection.username);
		connection.socket.terminate();
		connections.delete(closeid);
		if (unions[closeid] != -1) {
			var i = unions[callerid];
            unions[i] = -1;					   
			unions[callerid] = -1;
		}
		presenceUpdate();
     }
      else {
        ws.ping();
        ws.pingssent++;
		if (LOG & log_pong) {
	       crtclog.info("PING: ping id");
	    }
      }
    }, 15 * 1000);   //  5 seconds between pings

    ws.on("pong", function() {    // we received a pong from the client.
	   if (LOG & log_pong) {
	       crtclog.info("PING: pong received");
	   }
       ws.pingssent = 0;    // reset ping counter.
    }); 
	// --- end keep alive
	
	ws.on('close', function() {
		var closeid = wSockets.get(ws);
		var connection = connections.get(closeid);
		if (typeof connection != 'undefined') {
			if (LOG & log_ws) {
				crtclog.info("WS: connection closed [%d] %s", closeid, connection.username);
			}	
			clearInterval(connection.timerid);
			reuseids.push(closeid);
			if (connection.userusername != null) {
				registrar.delete(connection.username);		
			}
			connection.socket.terminate();
			registrar.delete(connection.username);
			connections.delete(closeid);
			wSockets.delete(ws);
			presenceUpdate(); 
		}
	});
	
    ws.on('message', function(message) {
		if (LOG & debug_ws) {
           crtclog.info('WS: received msg: %s', message);
		}
		try { 
		  signal = JSON.parse(message); 
		  id = signal.token;
		  var connection = connections.get(id);
		  
		  if (typeof connection == 'undefined') {
			  crtclog.error("WS: Connection object for id %s not found.  Message %s", id, message);
			  return;
		  }
		  
		  // REGISTRATION MANAGEMENT
		  // -----------------------
	      if (signal.type === "register") {
			// validate
			
            if (validation.validate(signal.username, signal.password) == false) {
           
			   crtclog.warn("Registration for %s failed validation", signal.username);
			   ws.send(JSON.stringify({
			  	  type:    "response",
				  request: "register",
				  status:  "failed"
				}));
                return;				
			}
            else {
				if (LOG & debug_ws) {
					  crtclog.warn("Validation for %s accepted", signal.username);
				}
			}			
			// register the user and associate with a websocket	 
            // replace any existing registration for this user
			var callerid = registrar.get(signal.username);
			if (callerid != "unknown") {
				// we already know about this user
				// cleanup old connection with this one
				if (LOG & log_ws) {
					crtclog.info('WS: replacing existing connectionid %d for username %s', callerid, signal.username);
				}
				var oldconnection = connections.get(callerid);
				if (typeof oldconnection != 'undefined') {
					oldconnection.socket.send(JSON.stringify({
						type:    "serverdisconnect",
						text:    "Presence updated",
						usrname: signal.username	
					}));
					if (LOG & log_ws) {
						crtclog.info('WS: replacing existing connectionid %d for userid %d', oldconnection.id, id);
					}
					if (typeof oldconnection.ws != 'undefined') {
						crtclog.info("Websocket found for existing id %d", callerid); 
					}
					clearInterval(oldconnection.timerid);
  					oldconnection.socket.close();
					crtclog.info("OK done");
					wSockets.delete(oldconnection.socket);
					connections.delete(callerid);
					if (unions[callerid] != -1) {
					   var i = unions[callerid];
                       unions[i] = -1;					   
					   unions[callerid] = -1;
					}
				}
				registrar.delete(signal.username);
			}

			unions[id] = -1;
			registrar.set(signal.username, id);
			connection.username = signal.username;
			connections.set(id, connection);

			// return the server token
			ws.send(JSON.stringify({
			  	  type:    "response",
				  request: "register",
				  status:  "ok",
				  id:   id 
				}));
				
			// notify everyone of my arrival ?	
			presenceUpdate(); 
			return;
	      }
		  else if (signal.type === "unregister") {
			clearInterval(connection.timerid);
			reuseids.push(id);
		    registrar.delete(connection.username);
		    connection.socket.terminate();
	    	connections.delete(id);
	    	if (unions[id] != -1) {
		 	    var i = unions[id];
                unions[i] = -1;					   
			    unions[id] = -1;
		    }
		    presenceUpdate();
			return;
		  }
		  // CALL MANAGEMENT
		  // ---------------
		  else if (signal.type === "invite") {
			var calleeid = registrar.get(signal.remoteusername);
			if (calleeid === "unknown") {
				ws.send(JSON.stringify({
			  	  type:    "response",
				  request: "invite",
				  status:  "failed",
				  error:   "Callee not found" 
				}));
				return;
			}
			// callee id found
			if (unions[calleeid] == -1) {   // point-2-point call
			     if (LOG & log_ws) {
					 crtclog.info("WS: Invite from %d to %d", signal.token, calleeid);
				 }
				 var invitedconnection = connections.get(calleeid);
				 if (typeof invitedconnection != 'undefined') {
					if (LOG & debug_ws) {
						crtclog.info("WS: forward Invitefrom from " +id +"to " +calleeid);
					} 
				    invitedconnection.socket.send(JSON.stringify({
						   type : "invitefrom",
						   username : connection.username,
						   fromid: id,
						   toid : calleeid
					}));
					if (LOG & debug_ws) {
						crtclog.info("WS: Invitefrom from " +id +"to " +calleeid + " sent");
					} 
				 }			 
			}
			else {  // point-2-point becomes a conference
			     unions[id] = unions[calleeid];
				 unions[calleeid] = id;
				 // hummmm ... need to see how this works in practice
			}
			return;
		  }
		  else if (signal.type === "inviteresponse") {
		      if (LOG & log_ws) {
				  crtclog.info("WS: Invite response (In response to Invite from " +signal.remoteuserid +" to " +signal.token +")");
			  }
			  var i = parseInt(signal.remoteuserid);
			  // connect the two agents
			  if (signal.status === "ok") {
				  unions[id] = i;
				  unions[i] = id;
			  }
			  var invitingconnection = connections.get(i);
			  crtclog.info("REMOTE inviteresponse @3 " +i +"  type " +typeof invitingconnection);
		      if (LOG & debug_ws) {
				  crtclog.info("WS: Invite response (In response to Invite from " +invitingconnection.username +" to " +signal.username +")");
			  }			  
			  if (typeof invitingconnection != 'undefined') {
				    if (LOG & log_ws) {
				      crtclog.info("WS: Sending Invite response to " +invitingconnection.username);
			        }
				    invitingconnection.socket.send(JSON.stringify({
						   type : "response",
						   request : "invite",
						   status : signal.status,
						   remoteuserid: signal.token,
						   remoteusername: signal.username				   
					}));				  
			  }
			  return;
		  }
	      else if (signal.type === "hangup") {
			var nextid = unions[id];
			if (LOG & debug_ice) {
				crtclog.info("ICE:  [%d]->[%d]  hangup", id, firstid);
			}
			var firstid;
		    var lastid;
		
			while (nextid != -1 && nextid != firstid) {
				if (typeof firstid == 'undefined') { firstid = nextid;}
				// todo:  handle conference
				if (nextid != id) {
				        var peerconnection = connections.get(nextid);
				        if (peerconnection != null) {
					       peerconnection.socket.send(JSON.stringify({
						     type : "callend",
						     remoteid : id
					      }));
				       }
					   if (LOG & debug_ice) {
						   crtclog.info("ICE:  [%d]->[%d]  hangup sent", id, nextid);
					   }
				}
				else {
					if (typeof lastid != 'undefined') {
						unions[lastid] = unions[nextid];   // remove us from the chain
					}
				}
				lastid = nextid;
				nextid = unions[nextid];
			}
            unions[id] = -1;			
		  }
		  // WEBRTC MEDIA NEGOTIATION
		  // ------------------------
		  else if (signal.type === "icecandidate") {
			var nextid = unions[id];
			var firstid;
			if (LOG & debug_ice) {
				crtclog.info("ICE:  [%d]->[%d]  %s", id, nextid, signal.icecandidate);
			}			
			while (nextid != -1 && nextid != firstid) {
				if (typeof firstid == 'undefined') { firstid = nextid; crtclog.info("firstid %d", firstid); }
			    var peerconnection = connections.get(nextid);
			    if (typeof peerconnection != 'undefined') {
					if (nextid != id) {
						// send ice candidate to all channels in the call/conference
						peerconnection.socket.send(JSON.stringify({
							type: "remoteicecandidate",
							id: id,
							icecandidate : signal.icecandidate
							}));
						if (LOG & debug_ice) {
							crtclog.info("ICE:  [%d]->[%d]  remoteicecandidate", id, nextid);
						}
					}
			    }
				nextid = unions[nextid];
			  }
		  }
		  else if (signal.type === "sdp") {

			var nextid = unions[id];
			var firstid;
			if (LOG & debug_ice) {
				crtclog.info("SDP:  [%d]->[%d]  %s", id, nextid, signal.description);
			}
			while (nextid != -1 && nextid != firstid) {
				if (nextid != id) {
					if (typeof firstid == 'undefined') { firstid = nextid; }
					var peerconnection = connections.get(nextid);
					if (typeof peerconnection != 'undefined') {
			    
						// send a media description to all channels in the call/conference
						peerconnection.socket.send(JSON.stringify({
							type: "remotesdp",
							id: id,
							description : signal.description
							}));
						if (LOG & debug_ice) {
							crtclog.info("SDP:  [%d]->[%d]  remotesdp", id, nextid);
						}
					}
				}
				nextid = unions[nextid];
			}
		  }		  
		  // Directory
		  // ---------
		  else if (signal.type === "directory") {
			  var start = 1;
			  var end   = 100000;
			  if (typeof signal.start != 'undefined') {
			     start = signal.start;
			     end = signal.end;
			  }
			  
			  var directory = {
                 userid: []
              };
			  
			  connections.forEach(function(conn, cid, object) {
				  if (LOG & debug_ws) {
				     crtclog.info("WS: forEach myid %d  connectionid %d ", id, cid);
				  }
				  if (cid != id) {
					 crtclog.info("WS: examining connection %d  %s", cid, conn.username); 
					 directory.userid.push(conn.username); 
				  }			  
			  });
			  ws.send(JSON.stringify({
			  	       type: "directorylisting",
				       directory: directory.userid
				    }));
		  }
		  else {
			  crtclog.error("WS: Unrecognized message received " +signal);
		  }
	    } catch(e) { 
		    crtclog.error("WS: Error handling message: %s", e.message);
		};
    });
	
	var connection = {
		id:     id,
		socket: ws,
		timerid: timer
	}
	if (LOG & log_ws) {
		crtclog.info("WS: Adding connection for id " +id);
		crtclog.info("WS: Adding socket " +ws +" for id " +id);
	}
    connections.set(id, connection);
	unions[id] = -1;
	wSockets.set(ws, id);
	
	ws.send(JSON.stringify({
		type: "id",
        token: id
      }));
	   
});

function presenceUpdate() {
	// send a notification to all of a new arrival
	if (LOG & debug_ws) {
        crtclog.info("WS: presenceUpdate");
	}	
	var debugcount =0;
	connections.forEach(function(conn, cid, object) {
		if (LOG & debug_ws) {
		   crtclog.info("WS: presenceUpdate   connectionid %d", cid);
			crtclog.info("debugcount %d", debugcount);
			crtclog.info("WS: examining connection %d  %s", cid, conn.username); 
	    }
		conn.socket.send(JSON.stringify({
			type: "presence"
		}));  
		++debugcount;
//		if (debugcount > 10) {
//			return;
//		}
	});	
}

function replace(inputstr, findstr, replacestr) {
	  var i = inputstr.indexOf(findstr);  
}

function startsWith(str, prefix) {
    return str.indexOf(prefix) === 0;
}


function httpdirectory() {
	
	var httpstr = "";  //"<select style="width: 298px;"";
	var selectattr = " name=\"contactname\" ";
	
	//debug 
	/*
	if (connections.length == 0) {
		var thttpstr = "<select style=\"width: 298px;\" size=2 name=\"contactname\">";
		thttpstr +="<option name=\"xxxx\">xxxx</option><option name=\"yyyy\">yyyy</option>";
		thttpstr +="</select>";
		return thttpstr;
	}
	*/
	
	if (connections.length > 20) {
		http = "<select style=\"width: 298px;\" "+selectattr +" size=" +connections.length +">";
	}
	else {
		http = "<select style=\"width: 298px;\" size=20" +selectattr +">";
	}
	
	for(var i=0; i< connections.length; ++i) {
	    if (LOG & debug_http) {
	         crtclog.info("HTTP: start current end %d %d %d ", start, i, connections.length);
	    }
	    var dconnection = connections.get(i);
        if (dconnection != null) {
			if (LOG & debug_http) {
			    crtclog.info("Connection %d found", i);  
			}
		    if  (dconnection.username != null) {
			    if (LOG & debug_ws) {	
			         crtclog.info("connection %d %s ", i, dconnection.username);
				}
			    httpstr += "<option value=\"" +dconnection.username +"\">"+dconnection.username+"</option>";
			}
	    }	  
	}
	httpstr += "</select>";
    return httpstr;	
}




