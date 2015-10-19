/**
 *  crtc
 *
 *  by Colm Quinn quinncolm@optonline.net
 *
 *
 * Routines to message the signalling server, handling registration, wrtc session setup
 * Not part of the public interface.  Intended only for use by agent.js
 *
 * Basic design is set a number of persistent callbacks to handle asynch events (e.g. remote peer "hangs up" call)
 * Most other methods will set nextcallback to deal with their specific response - failing to wait for the respnse will 
 * cause confusion - the callback may fire for the wrong event.
 *
 *  Need a cleaner mechanism - probably a map of callbacks with a "dialog id" much like cseq in SIP
 */
 
/* dummy out console.log if it does not exist */ 
if (!window.console) window.console = {};
if (!window.console.log) window.console.log = function () { };

var server = null;
var ok    = false;
var error = null;
var token = 0;        // id from server

var username;

var webrtcagent;

// callbacks
var directorycallback;
var incominghangup;
var nextcallback;
var incomingicecallback;
var incominginvitecallback;
var incomingsdpcallback;
var serverdisconnectcallback;

// register as 'present' i.e. available for calls with the server
// registration response will assign us a token used in all other communication with the server
// callbacks:
//   callback - response to registration )agent.js)
//   incomingcallback firse when we receive an invite to a session from a remote peer (api)
//   servercallback fires when server disconnects the agent.
function rtcregister(url, user, pass, callback, incomingcallback, servercallback) {
	// connect
	nextcallback = callback;
	incominginvitecallback = incomingcallback;
	serverdisconnectcallback = servercallback;
	if (typeof 'undefined' == incominginvitecallback) {
		console.log("incoming invite callback is undefined.  Unable to accept calls");
	}
	username = user;
	password = pass;
	server = new WebSocket("wss://"+url);
	server.onopen = function() {
		// setup caller signal handler
		server.onmessage = server_onmessage;
		server.onerror   = server_onerror;
		server.onclose   = server_onclose;
        	
	};	
}

// unregister 

function rtcunregister() {
	server.send(
			JSON.stringify({ 
				token:token,
				type:"unregister",
				username:username
			})
	);	
}

//  get the list of all other active users - i.e. not ourselves

function rtcrequestdirectory(callback) 
{
	directorycallback = callback;
	//console.log("agentrequestdirectory " +token);
	server.send(
			JSON.stringify({ 
				token:token,
				type:"directory",
				username:username
			})
	);

}

// send an invite ( i.e. "invite" another user to a call)
//  callbacks:   
//      callback - once a response is received  (from api)
//      sdpcallback - callback to handle remote sdp (from agent.js)
//      icecallback - call back on receipt of remote peer ice candidates (from agent.js)
function rtcinvite(remoteusername, callback, sdpcallback, icecallback) {
	nextcallback = callback; 
	incomingicecallback = icecallback;
	incomingsdpcallback = sdpcallback;
	server.send(
			JSON.stringify({ 
				token:token,
				type:"invite",
				username:username,
				remoteusername:remoteusername
			})
	);	
}

// respone to an "invite" from another peer
//  callbacks:   
//      sdpcallback - callback to handle remote sdp (from agent.js)
//      icecallback - call back on receipt of remote peer ice candidates (from agent.js)
function rtcinviteresponse(status, remoteid, sdpcallback, icecallback) {
	incomingsdpcallback = sdpcallback;
	incomingicecallback = icecallback;
	server.send(
			JSON.stringify({ 
				token:token,
				type:"inviteresponse",
				status: status,
				username:username,
				remoteuserid:remoteid
			})
	);		
}

//  send our sdp to remote peer
function rtcsendsdp(description) 
{
	server.send(
		JSON.stringify({
			token:token,
			type:"sdp",
			description: description
		})
	);
}

// send our ice candidate to remote peer
function rtcsendicecandidate(candidate) {
	server.send(
		JSON.stringify({
			token:token,
			type:"icecandidate",
			icecandidate:candidate
		})
	)
}

//  end a webrtc session - 
//     we send this to the signalling server so if knows we are again available
function rtchangup() {
	server.send(
			JSON.stringify({ 
				token:token,
				type:"hangup"
			})
	);		
}

// set callback for asychronous close of a webrtc session
function rtcsetsessionclosecallback(callback) {
	incominghangup = callback;
}

// set callback for report of server error
//  may wish to set this undefined ao as not to inerrupt a call in progress
function rtcsetservererrorcallback(callback) {
	serverdisconnectcallback = callback;
}

// generic send.  Add in the token we received on registation
function rtcsendjson(jsonmsg) 
{
	jsonmsg['token'] = token;
	server.send(jsonmsg);
}


//  Handle inbound messages

function server_onmessage(event)
{
	try {
	   var msg = JSON.parse(event.data);	
	   if (msg.type === "id") {
			// register ....
			//console.log("Id " + msg.token);
			token = msg.token;
			server.send(
					JSON.stringify({ 
						token:msg.token,
						type:"register",
						username:username
					})
			);	
			//console.log("registtration sent " + msg.token);
	   }
	   else if (msg.type === "remoteicecandidate") {
	      // ice candidate from remote peer push to webrtc connection object
		    incomingicecallback(msg.icecandidate);
	   }
	   else if (msg.type === "invitefrom") {
		   //console.log("Incoming call");
		   incominginvitecallback(msg.username, msg.fromid);
	   }
	   else if (msg.type === "callend") {
		   //console.log("Incoming callend %d", msg.hangupid);
		   if (typeof incominghangup != 'undefined') {
			   incominghangup(msg.remoteid);
		   }
	   }
	   else if (msg.type === "directorylisting") {
		    //console.log("Directory listing " +event.data);
		   	if (typeof directorycallback != 'undefined') {
			   //console.log("msg.directory " + msg.directory.length +" " +msg.directory[0]);
			   //console.log("Directorylisting callback " +msg.directory);	
			   directorycallback(msg.directory);
			}
	   }   
	   else if (msg.type === "remotesdp") {
		   //console.log("remotesdp received " + msg.description.sdp);
		   if (typeof incomingsdpcallback != 'undefined') {
			   incomingsdpcallback(msg.description);
		   }
	   }
	   else if (msg.type === "presence") {
		   // something has changed - reload the directory
		   // TODO:
		   // this should be changed to something which includes the change type to avoid 
		   // pulling the entire directory.  Requires a smarter callback
		   if (typeof directorycallback != undefined && typeof directorycallback != null) {
			   rtcrequestdirectory(directorycallback);  
		   }
	   }
	   else if (msg.type === "serverdisconnect") {
		   serverclose(msg.text);
	   }
	   else if (msg.type === "response") {
		   //console.log("%s response to %s", msg.status, msg.request);
		   if (msg.status === "failed") {
		       console.log("%s failed with error %s", msg.request, msg.error);
		   }
		   fireCallback(msg.status);
	   }
	   else {
		  console.log("Unknown wsmessage received");
       }
	}
	catch(e) {
		console.log("Exception handling incoming message " + event.data + "\n" + e.message);
	}
}

function server_onerror() 
{
	//console.log("Error on signaling server connection");
	text = "Error on signaling server connection";
	if (typeof nextcallback != 'undefined' && nextcallback != null) {
	   try {
	       nextcallback('failed');
	   }
	   catch(e) {
		   console.log("Exception on callback " +e.message +'\n' +e.stacktrace);
	   }
	   nextcallback = null;		
	}	
	if (typeof serverdisconnectcallback != 'undefined' && serverdisconnectcallback != null) {
		serverdisconnectcallback(error);
	}
}

function server_onclose() {
	//console.log("Signaling server connection closed ");
	text = "Signaling server connection closed";
	if (typeof nextcallback != 'undefined' && nextcallback != null) {
	   try {
	       nextcallback('Connection closed');
	   }
	   catch(e) {
		   console.log("Exception on callback " +e.message +'\n' +e.stacktrace);
	   }
	   nextcallback = null;
	}
	if (typeof serverdisconnectcallback != 'undefined' && serverdisconnectcallback != null) {
		serverdisconnectcallback();
	}
}



// Generic method to fire the "nextcallback" if it exists
function fireCallback(status) {
	if (typeof nextcallback != 'undefined' && nextcallback != null ) {
	   //console.log("fireCallback - preentry");
	   try {
	       nextcallback(status);
	   }
	   catch(e) {
		   console.log("Exception on callback " +e.message +'\n' +e.stacktrace);
	   }
	   nextcallback = null;
	   //console.log("fireCallback - postentry");
	}
}

function serverclose(text) {
	//console.log("Signaling server connection closed " + text);
	if (typeof text == 'undefined') {
	     text = "Signaling server connection closed";
	}
	if (typeof nextcallback != 'undefined' && nextcallback != null) {
	   try {
	       nextcallback('Connection closed');
	   }
	   catch(e) {
		   console.log("Exception on callback " +e.message +'\n' +e.stacktrace);
	   }
	   nextcallback = null;
	}
	if (typeof serverdisconnectcallback != 'undefined' && serverdisconnectcallback != null) {
		serverdisconnectcallback(text);
	}
}