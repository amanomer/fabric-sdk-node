module.exports.bestPeers = function (peers){
    console.log(peers);
    console.log('fabric-sdk-node v1.2');
    console.log('***Calling bestPeer***');
    console.log('-->Function will recieve a peer from each organization involved');
	console.log('-->This will return consistently efficient peers of each organization');
    console.log('-->Task 1: Load all peers of particular organization');
    console.log('-->\tTask 1.1: Needs the list of all peers');
    console.log('-->Task 2: Select best peer');
    console.log('-->Task 2.1:Calls the statistical model');
    console.log('\n\nArgument recieved is as follows:');
    console.log(peers);
    console.log('Argument finished\n');
}