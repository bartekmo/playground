var AWS = require( 'aws-sdk' );
var region = 'eu-west-2';
AWS.config.update({ 'region': region });
var ec2 = new AWS.EC2({ apiVersion: '2016-11-15' });

var params2 = {
  Owners: [ 'aws-marketplace' ],
  Filters: [
    {
      Name: 'is-public',
      Values: [
        'true'
      ]
    },
    {
      Name: 'product-code',
      Values: [
        '13c1klx5r09qodluv3tjtdptk',
        'jr94cljmamy66bgt6oj77vmy',
        '2y8tx74n5zcana6h8xcw99xsb'
      ]
    }
  ]
}

var res = {} //result buffer
var pubdateRegEx = /^20\d{2}[01]\d[0123]\d$/
var templateObj = {}
var versions = []

function isOlderAmi( amiInfo, pubDates ) {
  //is passed ami older than the one we've seen before for the same version and license

  if ( !pubDates[ amiInfo.lic ]) {
    pubDates[ amiInfo.lic ] = {};
    pubDates[ amiInfo.lic ][ amiInfo.ver ] = amiInfo.pubDate;
    return false;
  }

  if ( !pubDates[ amiInfo.lic ][ amiInfo.ver ]) {
    pubDates[ amiInfo.lic ][ amiInfo.ver ] = amiInfo.pubDate;
    return false;
  }

  if ( pubDates[ amiInfo.lic ][ amiInfo.ver ] < amiInfo.pubDate ) {
    pubDates[ amiInfo.lic ][ amiInfo.ver ] = amiInfo.pubDate;
    return false;
  }

  return true;
} //isOlderAmi

function fillAmisForRegion( region ) {
  return new Promise( function( fulfill, reject ) {
    let ec2 = new AWS.EC2({ 'region': region });
    var pubDates = {};

    ec2.describeImages( params2, function(err,data) {
      if ( err ) {
        reject( err );
      } else {
        for( var ami of data.Images ) {
          var amiInfoRaw = ami.Description.split(']')[1].substring( String( ' CudaNGF' ).length ).split('-');
          var amiInfo = { "region": region };
          amiInfo.lic = amiInfoRaw[0];
          amiInfo.ver = amiInfoRaw[1].substring(1).split('').join('.');
          var mapName = "amiMap"+amiInfoRaw[1];
          if( pubdateRegEx.test( amiInfoRaw[ amiInfoRaw.length - 1 ] )) {
            amiInfo.pubDate = Number( amiInfoRaw[ amiInfoRaw.length - 1 ]);

            //initialize object property tree if needed
            if ( res.amiMapMap == undefined ) {
              res.amiMapMap = {}
            }
            res.amiMapMap[ amiInfo.ver ] = { "mapName": mapName };
            if ( !versions.includes( amiInfo.ver )) {
              versions.push( amiInfo.ver )
            }
            if ( res[ mapName ] == undefined ) {
              res[ mapName ] = {};
            }
            if ( res[ mapName ][ region ] == undefined ) {
              res[ mapName ][ region ] = {};
            }

            //check if it's the only || newest ami for this version and save
            if ( !pubDates[ amiInfo.lic ]) {
              pubDates[ amiInfo.lic ] = {};
            }
            if ( !pubDates[ amiInfo.lic ][ amiInfo.ver ] || pubDates[ amiInfo.lic ][ amiInfo.ver ] < amiInfo.pubDate) {
              pubDates[ amiInfo.lic ][ amiInfo.ver ] = amiInfo.pubDate;
              console.log( "push => " + ami.Description +">"+ pubDates[ amiInfo.lic ][ amiInfo.ver ]);
              res[ mapName ][ region ][ amiInfo.lic ] = ami.ImageId;
            } else {
              console.log( "skip XX " + ami.Description +"<"+ pubDates[ amiInfo.lic ][ amiInfo.ver ]);
            }

          } else {
            console.error( ' !!! Wrong description for ' + region +'/'+ ami.ImageId + ': ' + ami.Description );
          }
        } //for each ami in region

        //fulfill once we're done with parsing results
        fulfill( res );
      } // we got data
    }) //describeImages() callback
  }) //new Promise
} //fillAmisForRegion()

//getContent() function borrowed from https://www.tomas-dvorak.cz/posts/nodejs-request-without-dependencies/
const getContent = function(url) {
  // return new pending promise
  return new Promise((resolve, reject) => {
    const https = require( 'https' );
    const request = https.get(url, (response) => {
      // handle http errors
      if (response.statusCode < 200 || response.statusCode > 299) {
         reject(new Error('Failed to load page, status code: ' + response.statusCode));
      }
      // temporary data holder
      const body = [];
      // on every content chunk, push it to the data array
      response.on('data', (chunk) => body.push(chunk));
      // we are done, resolve promise with those joined chunks
      response.on('end', () => {
        templateObj = JSON.parse(body.join(''));
        resolve(templateObj)
      });
    });
    // handle connection errors of the request
    request.on('error', (err) => reject(err))
    })
}

// get the template for the template from github
var templateUrl;
if ( process.argv[2] ) {
  templateUrl = process.argv[2];
  console.log( "Getting template template from\n" + templateUrl );
} else {
  templateUrl = "https://raw.githubusercontent.com/bartekmo/ngf-aws-templates/ha-shifted-eip/HA%20Cluster/CGF_HA_floatingEIP.tmpl.json";
}
var templatePromise = getContent( templateUrl )
  .catch((err) => {console.error(err)})

ec2.describeRegions({}, async function( err, data ) {
  if ( err ) console.error( err, err.stack );
  else {
    var regions = data.Regions;
    console.info( regions.length + ' regions found' );

    var promisePerRegion = [];
    for ( var regionIndx = 0 ; regionIndx < regions.length ; regionIndx++ ) {
      //for each region get all images run the fill function in parallel and gather promises
      promisePerRegion[ regionIndx ] = fillAmisForRegion( regions[ regionIndx ].RegionName );
    } //for each region

    //wait until all are done
    await Promise.all( promisePerRegion );
    await templatePromise;

    templateObj.Mappings = res;
    templateObj.Parameters.ReleaseVersion.AllowedValues = versions;

    var resSaveParams = {
      Body: JSON.stringify( templateObj ),
      Bucket: "cuda-cgf-templates",
      Key: "CGF_HA_floatingEIP.json",
      ACL: "public-read"
    }

    var s3 = new AWS.S3()
    s3.putObject( resSaveParams, function( err, data ) {
        if ( err ) {
          console.log( err );
        } else {
          console.log( data );
        }
    })


  } //we got data
}) //describeRegions
