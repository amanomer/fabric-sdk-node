/**
 * Copyright 2016 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

'use strict';

var util = require('util');
var winston = require('winston');
var fs = require('fs-extra');
var crypto = require('crypto');
var path = require('path');
var os = require('os');
var settle = require('promise-settle');
var utils = require('./utils.js');
var logger = utils.getLogger('client-utils.js');
var Config = require('./Config.js');
var Constants = require('./Constants.js');
var Peer = require('./Peer.js');
var EventHub = require('./EventHub.js');
var Orderer = require('./Orderer.js');
var model = require('./StatisticalModel');

var grpc = require('grpc');
var _commonProto = grpc.load(__dirname + '/protos/common/common.proto').common;
var _proposalProto = grpc.load(__dirname +
	'/protos/peer/proposal.proto').protos;
var _ccProto = grpc.load(__dirname + '/protos/peer/chaincode.proto').protos;
var _timestampProto = grpc.load(__dirname +
	'/protos/google/protobuf/timestamp.proto').google.protobuf;

/*
 * This function will build the proposal
 */
module.exports.buildProposal = function (invokeSpec, header, transientMap) {
	// construct the ChaincodeInvocationSpec
	const cciSpec = new _ccProto.ChaincodeInvocationSpec();
	cciSpec.setChaincodeSpec(invokeSpec);

	const cc_payload = new _proposalProto.ChaincodeProposalPayload();
	cc_payload.setInput(cciSpec.toBuffer());

	if (typeof transientMap === 'object') {
		logger.debug('buildProposal - adding in transientMap %s', util.inspect(transientMap));
		cc_payload.setTransientMap(transientMap);
	}
	else {
		logger.debug('buildProposal - not adding a transientMap');
	}

	// proposal -- will switch to building the proposal once the signProposal is used
	const proposal = new _proposalProto.Proposal();
	proposal.setHeader(header.toBuffer());
	proposal.setPayload(cc_payload.toBuffer()); // chaincode proposal payload

	return proposal;
};

/*
 * This function will return one Promise when sending a proposal to many peers
 */
module.exports.sendPeersProposal = function (peers, proposal, timeout) {
	let targets = peers;
	if (!Array.isArray(peers)) {
		targets = [peers];
	}
	// make function to return an individual promise
	const fn = function (peer) {
		return new Promise(function (resolve, reject) {
			peer.sendProposal(proposal, timeout).then(
				function (result) {
					resolve(result);
				}
			).catch(
				function (err) {
					logger.error('sendPeersProposal - Promise is rejected: %s',
						err.stack ? err.stack : err);
					return reject(err);
				}
			);
		});
	};
	// create array of promises mapping peers array to peer parameter
	// settle all the promises and return array of responses
	const promises = targets.map(fn);
	const responses = [];
	return settle(promises).then(function (results) {
		results.forEach(function (result) {
			if (result.isFulfilled()) {
				logger.debug('sendPeersProposal - Promise is fulfilled: ' +
					result.value());
				responses.push(result.value());
			} else {
				logger.debug('sendPeersProposal - Promise is rejected: ' +
					result.reason());
				if (result.reason() instanceof Error) {
					responses.push(result.reason());
				}
				else {
					responses.push(new Error(result.reason()));
				}
			}
		});
		return responses;
	});
};

/*
 * This function will sign the proposal
 */
module.exports.signProposal = function (signingIdentity, proposal) {
	const proposal_bytes = proposal.toBuffer();
	// sign the proposal
	const sig = signingIdentity.sign(proposal_bytes);
	const signature = Buffer.from(sig);

	// build manually for now
	const signedProposal = {
		signature: signature,
		proposal_bytes: proposal_bytes
	};
	return signedProposal;
};

/*
 * This function will build a common channel header
 */
module.exports.buildChannelHeader = function (
	type, channel_id, tx_id, epoch, chaincode_id, time_stamp, client_cert_hash) {
	logger.debug(
		'buildChannelHeader - type %s channel_id %s tx_id %d epoch % chaincode_id %s',
		type, channel_id, tx_id, epoch, chaincode_id);
	var channelHeader = new _commonProto.ChannelHeader();
	channelHeader.setType(type); // int32
	channelHeader.setVersion(1); // int32
	if (!time_stamp) {
		time_stamp = module.exports.buildCurrentTimestamp();
	}
	channelHeader.setChannelId(channel_id); //string
	channelHeader.setTxId(tx_id.toString()); //string
	if (epoch) {
		channelHeader.setEpoch(epoch); // uint64
	}
	if (chaincode_id) {
		let chaincodeID = new _ccProto.ChaincodeID();
		chaincodeID.setName(chaincode_id);

		let headerExt = new _proposalProto.ChaincodeHeaderExtension();
		headerExt.setChaincodeId(chaincodeID);

		channelHeader.setExtension(headerExt.toBuffer());
	}
	if(time_stamp) {
		channelHeader.setTimestamp(time_stamp); // google.protobuf.Timestamp
	}
	if(client_cert_hash) {
		channelHeader.setTlsCertHash(client_cert_hash);
	}
	return channelHeader;
};

/*
 * This function will build the common header
 */
module.exports.buildHeader = function (creator, channelHeader, nonce) {
	const signatureHeader = new _commonProto.SignatureHeader();
	signatureHeader.setCreator(creator.serialize());
	signatureHeader.setNonce(nonce);

	const header = new _commonProto.Header();
	header.setSignatureHeader(signatureHeader.toBuffer());
	header.setChannelHeader(channelHeader.toBuffer());

	return header;
};

module.exports.checkProposalRequest = function (request, skip) {
	var errorMsg = null;

	if (request) {
		if (!request.chaincodeId) {
			errorMsg = 'Missing "chaincodeId" parameter in the proposal request';
		} else if (!request.txId && !skip) {
			errorMsg = 'Missing "txId" parameter in the proposal request';
		}
	} else {
		errorMsg = 'Missing input request object on the proposal request';
	}
	return errorMsg;
};

module.exports.checkInstallRequest = function (request) {
	var errorMsg = null;

	if (request) {
		if (!request.chaincodeVersion) {
			errorMsg = 'Missing "chaincodeVersion" parameter in the proposal request';
		}
	} else {
		errorMsg = 'Missing input request object on the proposal request';
	}
	return errorMsg;
};

module.exports.translateCCType = function (type) {
	let chaincodeType = type ? type : 'golang';

	switch (chaincodeType.toLowerCase()) {
	case 'golang':
	default:
		return _ccProto.ChaincodeSpec.Type.GOLANG;
	case 'car':
		return _ccProto.ChaincodeSpec.Type.CAR;
	case 'java':
		return _ccProto.ChaincodeSpec.Type.JAVA;
	case 'node':
		return _ccProto.ChaincodeSpec.Type.NODE;
	}
};

/*
 * This function will create a timestamp from the current time
 */
module.exports.buildCurrentTimestamp = function () {
	var now = new Date();
	var timestamp = new _timestampProto.Timestamp();
	timestamp.setSeconds(now.getTime() / 1000);
	timestamp.setNanos((now.getTime() % 1000) * 1000000);
	return timestamp;
};

/*
* Returns a list of peers, which is sorted rankwise.
* This rank is calculated by statistical model which uses 
* the data recorded from previous transaction. 
* 
* @param {Peer[]} peers - List of Peer instances which is to be ranked.
* @param {String} role - Optional - Role for which peers ranking will be done. 
* If not specified, peers will be ranked on both EVENT_SOURCE_ROLE and ENDORSING_PEER_ROLE.
*
* @returns {Peer[]} - At index 0, there will be best performing peer.
*/
module.exports.discoverBestPeer = function (peers ,role) {
	let targets = peers;
	if (!Array.isArray(peers)) {
		targets = [peers];
	}
	// Function to return URL of peer.
	// Model identifies the peer by it's URL.
	const getIdentifier = function(peer){
		if(peer.getUrl()){
			return peer.getUrl();
		}
		else {
			throw new Error('Peer URL is missing');
		}
	}

	// targets are present and number of targets are greater than 1.
	if(targets && targets.length > 1){
		// Making list of URLs.
		var peerList = [];
		targets.forEach((peer)=>{
			peerList.push(getIdentifier(peer));
		});

		var u_peerList;
		try {
			// Rank peers for listening event.
			if(role === Constants.NetworkConfig.EVENT_SOURCE_ROLE) {
				u_peerList = model.runModel(peerList, Constants.NetworkConfig.EVENT_SOURCE_ROLE);
			}
			// Rank peers for Query.
			else if(role === Constants.NetworkConfig.ENDORSING_PEER_ROLE) {
				u_peerList = model.runModel(peerList, Constants.NetworkConfig.ENDORSING_PEER_ROLE);
			}
			// Rank peers for Invoke.
			// If no role is specified, peer which has performed best for endorsement 
			// And in event listening will be ranked highest.
			else {
				u_peerList = model.runModel(peerList );
			}
			// No value received.
			if(!u_peerList || u_peerList.length < 1){
				logger.debug("Unexpected results from model.");
				logger.debug("Returning peer list as received to continue transaction flow");
				u_peerList = peerList;
			}
		  } catch (err) {
			logger.debug("Peer list passed to model:",peerList);
			logger.error("Failed to run model",err);
			// For unintruppted transaction flow.
			u_peerList = peerList;
		  }
		let u_peers = null;
		u_peers = [];
		// Pushing the peer instance to the list
		u_peerList.forEach((peer)=>{
			targets.forEach((target)=>{
				if(peer === target.getUrl()){
					u_peers.push(target);
				}
			});
		})
		return u_peers;
	}
	else if(targets.length > 0 ){ 
		// Peer list is having single peer.
		// So ranking it will not be effective.
		// Returning that same peer.
		return targets;
	}
	else {
		// No peers have been passed.
		throw new Error('Parameter peers should not be null or empty.');
	}

};
