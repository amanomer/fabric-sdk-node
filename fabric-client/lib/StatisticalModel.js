var execSync = require('sync-exec');
var S = require('string');
var path = require('path');
var fs = require('fs');
var utils = require('./utils.js');
var logger = utils.getLogger('Statistical.js');

/* 
 * Currently 'find.py' is reading the rank.
 * This 'find.py' is in 'Model' directory.
*/
var filename = 'find.py';


module.exports.runModel = function (peers , role){
    var fileLocation = path.join(__dirname,'/Model/');
    // Looking for folder in the Fabric SDK cient folder.
    fs.stat(fileLocation+filename, function (err, stats) {
        if (err) {
            // Looking for folder in the client application directory
            fileLocation = path.join(process.cwd(),'/Model/')
            fs.stat(fileLocation+filename, function (err, stats) {
                if (err) {
                    logger.debug("Error in finding Model directory.");
                    logger.debug("Looking at location: %s",fileLocation);
                    throw new Error("Error in finding file");
                }    
            });
        }    
    });

    var command='python3 '+fileLocation+filename+' '+peers+' '+role+' '+__dirname;
    var user = execSync(command);
    var err=user.stderr.toString();
    if(err){
        logger.debug("THIS ERROR OCCURED IN MODEL WHILE EXECUTING python COMMAND.");
        logger.debug(err);
        throw new Error(err);
    }
    // Result will have a character array.
    var result=user.stdout.toString();
    // To extract a desired result in string.
    result=S(result).between('[\'','\']').toString().split(',');
    var u_peerList=[];
    // Match it with the peers passed.
    result.forEach((r)=>{
        peers.forEach((p)=>{
            if(S(r).contains(p)){
                u_peerList.push(p);
            }
        });
    });
    return u_peerList;
}

/*
 * Performance will further be improved if runModel() doesnot require python command for reading file.
 * Write ranks of peer in json file which will directly read by this runModel().
 */