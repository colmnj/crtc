/*
 *  crtc
 *
 *  by Colm Quinn quinncolm@optonline.net
 *
 *
 * Agent.js is the crtc api.
 *
 * Basic design is set a number of persistent callbacks to handle asynch events (e.g. remote peer "hangs up" call)
 * Most other methods will set nextcallback to deal with their specific response - failing to wait for the respnse will 
 * cause confusion - the callback may fire for the wrong event.
 *
 *  Need a cleaner mechanism - probably a map of callbacks with a "dialog id" much like cseq in SIP
 */

 
 
/*
 *  agent :  public interface
 *
 *  Usage  
 *    agentregister    - declare present
 *    agentunregister  - leave
 *    agentregistrations - get a list of all users currently present
 *    sgentpollregistrations - periodically update list of all users currently present
 *    agentstoppollregistrations - stop all polling for present users
 *
 *   Caller:
 *    agentinvite
 *
 *
 *   Called:
 *     agentacceptinvitation
 *     agentrejectinvitation
 *
 *   Webrtc session setup
 *     agentconnect
 *     
 */

 /* dummy out console.log if it does not exist */ 
if (!window.console) window.console = {};
if (!window.console.log) window.console.log = function () { };
 
var peerconnection;
var username;

// Signalling server functions
// ----------------------------

// Registration, Presence, User directory
// =======================================
function agentregister(host, user, password, callback, invitecallback, servercallback) {
	username = user;
	if (typeof 'undefined' == invitecallback) {
		console.log("incoming invite callback is undefined.  Unable to accept calls");
	}
	rtcregister(host, username, password, callback, invitecallback, servercallback);
}

function agentunregister() {
	agentstoppollregistrations();
	rtcunregister(username);
}

var timerid;

function agentpollregistrations(callback, interval) {
	// update the directory list every x ...minutes
	// May not need to do this
	rtcrequestdirectory(callback);
	timerid = setInterval(function() { rtcrequestdirectory(callback); }, interval);
}

function agentregistrations(callback) {
	rtcrequestdirectory(callback);
}

function agentstoppollregistrations() {
	if (typeof timerid != 'undefined' && timerid != null) {
		clearInterval(timerid);
	}
	timerid = null;
}

//  Invite to session
//  ==================


function agentinvite(remoteusername, callback) {
	rtcinvite(remoteusername, callback, incomingdescription, incomingicecandidate);
}

function agentacceptinvitation(remoteusername, remoteid) {
	
	rtcinviteresponse("ok", remoteid, incomingdescription, incomingicecandidate);
}

function agentrejectinvitation(remoteusername, remoteid) {
	rtcinviteresponse("failed", remoteid, null, null);
}

// Webrtc functions
// -----------------
/*
 *   Caller callflow
 *     - getusermedia
 *         get peerconnection
 *         register the onicecandidate handler
 *            sends icecandidate to other agent via signaling
 *       register the onaddstream
 *            when a remote stream received     
 *       register the message handler
 *            handle incoming icecandidates
 *       getusermedia
 *            audio/video -> asycb onsuccess
 *       offer/answer process
 *       
 *    Callee callflow
 *      - get peerconnection
 *        register the onicecandidate handler
 *        regiwter the onaddstream
 *        register the message handler
 *        getusermedia
 *
 *          
 */
var caller = false;
var sessionclosedcallback;
var errorcallback = null;
var successfulcallback = null;
var sdpConstraints =  { 'mandatory': {"offerToReceiveAudio":true,"offerToReceiveVideo":true} };

/*
 * agentconnect
 */
 
function agentconnect(useAudio, useVideo, firstcaller, onsessionclosedcallback, mediaconnected, mediafailed) 
{	
    caller = firstcaller;
	sessionclosedcallback = onsessionclosedcallback;
	errorcallback = mediafailed;
	successfulcallback = mediaconnected;
	
	rtcsetsessionclosecallback(sessionclosedcallback);
	// set up environment, create peerconnection, and resolve browser differences (webrtc_sbrowser.js)
	var ok = initwebrtc();
	if (ok == false) {
		console.log('Agent could not be initialized');
	    return false;	
	}
			 
	get_user_media(
		{
			 video: true,
		   	 audio: true
		}, 
		onMediaSuccess, onGetUserMediaError);			  
}

function agentdisconnect() 
{
	rtchangup();
	caller = false;  // hangup
}

// ==============================================
// Internal webrtc logic and callbacks
// TODO:  This should move to a different source
// ===============================================

function onMediaSuccess(stream, media_element)
{
   //console.log("onMediaSuccess");
   
   peerconnection = make_peerconnection();
   peerconnection.onicecandidate = onIceCandidate;
   peerconnection.onaddstream    = onAddStream;
   
   connect_stream_to_src(stream, document.getElementById("local_video"));
   peerconnection.addStream(stream);

   if (successfulcallback != null) {
	  successfulcallback(caller);
   }
   successfulcallback = null;
   errorcallback = null;   
}

function onGetUserMediaError() 
{
    //console.log('GetUserMedia failed.   an error has occured');
    if (errorcallback != null) {
		errorcallback(caller);
	}	
    successfulcallback = null;
    errorcallback = null;   
}


/*
 *  SDP: CreateOffer/CreateAnswer
 */

function agentcreateoffer() {
	peerconnection.createOffer(onOfferCreated, onOfferFailed, sdpConstraints);
}

function onOfferCreated(description) {
	 
	 //console.log("onOfferCreated " + description.sdp);
     peerconnection.setLocalDescription(description);
     rtcsendsdp(description);
}

function onOfferFailed() {
    sessionclosedcallback("Connect failed.  Offer failed");
    caller = false;	
}

// Signalling Callback :  SDP from a remote peer has been received.
function incomingdescription(description)
{
	//console.log("incomingdescription");
	peerconnection.setRemoteDescription(new rtc_session_description(description));
	if (caller == false) {
		// if we are the agent being called we need to generate a response based on the incoming sdp
	    peerconnection.createAnswer(onOfferCreated, onOfferFailed, sdpConstraints);
	}
}


/*
 *
 * Stream handling
 *
 */

function onAddStream(event) 
{
   //console.log("onAddStream to remote_video");
   connect_stream_to_src(event.stream, document.getElementById("remote_video")); 	
}


/*
 * Ice candidate handling
 *
 */

function onIceCandidate(ice_event) {
	//console.log("onIceCandidate");
	rtcsendicecandidate(ice_event.candidate);
}

function incomingicecandidate(candidate)
{
	//console.log("incomingicecandidate " + candidate);
	if (candidate == null) { return; }
	peerconnection.addIceCandidate(new rtc_ice_candidate({   //new RTCIceCandidate({
		candidate: candidate.candidate,
		sdpMid: candidate.sdpMid,
		sdpMLineIndex: candidate.sdpMLineIndex,
		}));
}





