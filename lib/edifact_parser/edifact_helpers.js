'use strict';
const _ = require('lodash');
const { RequiredPropertyError } = require('./edifact_errors.js');


const flattenProperty = function flattenProperty (definitions, obj) {

  if (obj.$ref) {
    var match = (obj.$ref + '').match(/#\/definitions\/(.*)/);

    if (match) {
      // re-apply the definition over this key
      if (definitions[match[1]]) {
        _.defaults(obj, definitions[match[1]]);
      } else {
        throw new Error("EdiParser: Unable to find definition '" + match[1] + "' in schema definitions: ref: " + obj.$ref);
      }
    }
  } else if (obj.allOf) {
    if (obj.allOf && _.isArray(obj.allOf)) {
      _.each(obj.allOf, function (option) {
        if (option.$ref) {
          flattenProperty(definitions, option);
        } else {
          flattenRefs(definitions, option);
        }

        _.merge(obj, option);
      });

      delete obj.allOf;
    }
  }
};

const flattenRefs = function flattenRefs (definitions, obj) {
  if (obj.type === 'object') {
    // expand items on the object
    if (obj.$ref) {
      flattenProperty(definitions, obj);
    }

    _.each(obj.properties, (value, key) => {
      flattenProperty(definitions, value);
      flattenRefs(definitions, value);
    });
  } else if (obj.type === 'array') {
    const items = _.isArray(obj.items) ? obj.items : [obj.items];
    for (let i = 0; i < items.length; i++) {
      flattenProperty(definitions, items[i]);
      flattenRefs(definitions, items[i]);
    }
  }
};

let mergeDefaultEdiOpts = function (options) {
  const opts = options || {};
  _.defaults(opts, {
    componentDataElementSeparator: ':', // :
    dataElementSeparator: '+', // '+'
    decimalNotation: '.', // '.'
    releaseCharacter: '?', //  '?'
    reserved: ' ', //  ' '
    segmentTerminator: "'", //  '\''
  });

  return opts;
};

module.exports = {
  flattenRefs: flattenRefs,
};
