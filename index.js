'use strict';

const msconsCompleteParser = require('./lib/index.js');

const fs = require('fs');

if (require.main === module) {
  const path = process.argv[2];
  if (!path) {
    console.log('please enter path');
  } else {
    const content = fs.readFileSync(path, 'utf8');
    msconsCompleteParser.completeParser.parseDocument(
    content, (parserErr, parsedMscons) => {
      console.log(parserErr, parsedMscons);
    });
  }
}
