/*
Colm Quinn 2015

Node.js webrtc signalling websocket server

This module can be used to validate userid, password
Change as needed.
This placeholder version accepts all without question.

Replace this with your own implemtation.  Return true to allow registation, false to reject

*/

function validate(username, password) {
    return true;
}

module.exports.validate = validate;