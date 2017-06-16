'use strict';

const Edi = require('./edifact_parser/edifact_parser.js');
const fs = require('fs');
const assert = require('assert');

const ediConfig = {
  segmentSeparator: '\'',
  dataElementSeparator: '+',
  dataComponentSeparator: ':',
  releaseCharacter: '?',
};

function parseDocument (document, callback) {

  try {
    const jsonSchema = JSON.parse(
      fs.readFileSync(`${__dirname}/schemas/mscons99a.json.schema`, 'utf8'
    ));
    const reader = new Edi.EdiSegmentReader(document, ediConfig);
    const edi = new Edi.Edi(jsonSchema);

    const msconsJson = edi.parse(reader);

    const meteringpointIds = [];
    for (let i = 0; i < msconsJson.messages.length; i++) {
      const message = msconsJson.messages[i];
      for (let j = 0; j < message.segmentGroup5.length; j++) {
        const segmentGroup5 = message.segmentGroup5[j];
        for (let k = 0; k < segmentGroup5.segmentGroup6.length; k++) {

          const segmentGroup6 = segmentGroup5.segmentGroup6[k];

          const meteringpointId = segmentGroup6
          .placeLocationIdentifications
          .locationIdentification
          .locationName;

          if (segmentGroup6.datetimes) {
            for (let l = 0; l < segmentGroup6.datetimes.length; l++) {
              const datetime = segmentGroup6.datetimes[l];

              if (datetime.functionCodeQualifier === '163') {
                // segmentGroup6.datetimes.startDate = datetime.value;
                segmentGroup6.placeLocationIdentifications.startDate = datetime.value;

              } else if (datetime.functionCodeQualifier === '164') {
                // segmentGroup6.datetimes.endDate = datetime.value;
                segmentGroup6.placeLocationIdentifications.endDate = datetime.value;

              } else if (datetime.functionCodeQualifier === '9') {
                // segmentGroup6.datetimes.processingDate = datetime.value;
                segmentGroup6.placeLocationIdentifications.processingDate = datetime.value;
              }
            }
          }

          // attach start date and end date to quantity object.
          if (segmentGroup6.segmentGroup9) { // segmentGroup9 is conditional
            for (let l = 0; l < segmentGroup6.segmentGroup9.length; l++) {
              const segmentGroup9 = segmentGroup6.segmentGroup9[l];
              for (let m = 0; m < segmentGroup9.segmentGroup10.length; m++) {
                const segmentGroup10 = segmentGroup9.segmentGroup10[m];
                if (segmentGroup10.datetimes) { // datetimes of segmentGroup10 are conditional
                  for (let n = 0; n < segmentGroup10.datetimes.length; n++) {
                    const datetime = segmentGroup10.datetimes[n];
                    if (datetime.functionCodeQualifier === '163') {
                      segmentGroup10.quantity.startDate = datetime.value;
                    } else if (datetime.functionCodeQualifier === '164') {
                      segmentGroup10.quantity.endDate = datetime.value;
                    } else if (datetime.functionCodeQualifier === '9') {
                      segmentGroup10.quantity.processingDate = datetime.value;
                    }
                  }
                }
              }
            }
          }

          // console.log(meteringpointId);
          // if (!meteringpointId) {
          //   console.log(segmentGroup5);
          //   console.log(document.filename);
          // }

          meteringpointIds.push(meteringpointId);
        }
      }
    }
    assert(msconsJson.interchangeTrailer.interchangeControlCount === msconsJson.messages.length);
    callback(null, msconsJson);
  } catch (exception) {
    callback(exception);
  }
}

module.exports = {
  parseDocument,
  parseFile: function parseFile (location, callback) {
    fs.readFile(location, { encoding: 'utf-8' }, (err, data) => {
      if (err) {
        callback(err);
        return;
      }
      parseDocument(data, callback);
    });
  },
};
