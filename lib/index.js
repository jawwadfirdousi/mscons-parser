'use strict';

const completeParser = require('./mscons_parser.js');

module.exports = {
  completeParser,
  parseCompleteFile (location, cb) {
    completeParser.parseFile(location, cb);
  },

};
