/*


  webrtc_polyfill.js by Rob Manson
  NOTE: Based on adapter.js by Adam Barth

  The MIT License

  Copyright (c) 2010-2013 Rob Manson, http://buildAR.com. All rights reserved.

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.

 */
 
 /*
  * crtc: modified
  *   Added make_peerconnection - mozilla peerconnection constaints are now different "urls" rather than url
  *   agent_type added for quick check on implementation
  *   close_stream added
  */
 
/* dummy out console.log if it does not exist */ 
if (!window.console) window.console = {};
if (!window.console.log) window.console.log = function () { };
 
 
var webrtc_capable = true;
var rtc_peer_connection = null;
var rtc_session_description = null;
var get_user_media = null;
var connect_stream_to_src = null;
var stun_server = "stun.l.google.com:19302";

var agent_type = null;
var make_peerconnection;


function initwebrtc() {

	if (navigator.getUserMedia) { // WebRTC 1.0 standard compliant browser
		console.log("webrtc standard implementation");
		agent_type = "standard";
		rtc_peer_connection = RTCPeerConnection;
		rtc_session_description = RTCSessionDescription;
		rtc_ice_candidate = RTCIceCandidate;
		get_user_media = navigator.getUserMedia.bind(navigator);
		connect_stream_to_src = function(media_stream, media_element) {
			// https://www.w3.org/Bugs/Public/show_bug.cgi?id=21606
			media_element.srcObject = media_stream;
			media_element.play();
		};
		make_peerconnection = function() {
			return new rtc_peer_connection({    	 // RTCPeerConnection 
	           "iceServers": [                       // information about ice servers
	               { "url": "stun:"+stun_server },   // stun server info
	           ]
			})
		};
		closestream = function(element) {
			element.pause();
            element.src = null;
		};	
	} else if (navigator.mozGetUserMedia) { // early firefox webrtc implementation
	    console.log("webrtc firefox implementation");
		agent_type = "mozilla";
		rtc_peer_connection = mozRTCPeerConnection;
		rtc_session_description = mozRTCSessionDescription;
		rtc_ice_candidate = mozRTCIceCandidate;
		get_user_media = navigator.mozGetUserMedia.bind(navigator);
		connect_stream_to_src = function(media_stream, media_element) {
			media_element.mozSrcObject = media_stream;
			media_element.play();
		};
		stun_server = "74.125.31.127:19302";
		make_peerconnection = function() {
			return new rtc_peer_connection({    	 // RTCPeerConnection 
	           "iceServers": [                       // information about ice servers
	               { "urls": "stun:"+stun_server },   // stun server info
	           ]
			})
		};
		closestream = function(element) {
			element.pause();
            element.mozSrcObject=null;
		};
	} else if (navigator.webkitGetUserMedia) { // early webkit webrtc implementation
	    console.log("webrtc: webkit implementation");
		agent_type = "webkit";
	    var URL = window.URL || window.webkitURL;
		rtc_peer_connection = webkitRTCPeerConnection;
		rtc_session_description = RTCSessionDescription;
		rtc_ice_candidate = RTCIceCandidate;
		get_user_media = navigator.webkitGetUserMedia.bind(navigator);
		
/*		var context = new (window.AudioContext || window.webkitAudioContext)();
        var sineWave = context.createOscillator();
        sineWave.type = 0; // 0 is sineWave

        // Declare gain node
        var gainNode = context.createGain(); // createGainNode is deprecated

        // Connect sine wave to gain node
        sineWave.connect(gainNode);

        // Connect gain node to speakers
        gainNode.connect(context.destination);

        // Play sine wave
        sineWave.start(0); // noteOn is deprecated
        gainNode.gain.value = 0.9;
*/		
		connect_stream_to_src = function(media_stream, media_element) {
			media_element.src = URL.createObjectURL(media_stream);
		};
		make_peerconnection = function() {
			return new rtc_peer_connection({    	 // RTCPeerConnection 
	           "iceServers": [                       // information about ice servers
	               { "url": "stun:"+stun_server },   // stun server info
	           ]
			})
		};
		closestream = function(element) {
			element.pause();
            element.src = "";
		};		
	} else {
		alert("This browser does not support WebRTC - visit WebRTC.org for more info");
		webrtc_capable = false;
	}
	return webrtc_capable;
}