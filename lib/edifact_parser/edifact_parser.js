'use strict';
const _ = require('lodash');
const helpers = require('./edifact_helpers.js');
const Validator = require('jsonschema').Validator;
const { JsonSchemaValidationError } = require('./edifact_errors.js');
const moment = require('moment-timezone');

function ediItemFromConfig (name, config, level, parent) {

  if (config.edi_tag) {
    return new EdiSegment(name, config, level);
  }

  if (config.type === 'array') {
    return new EdiSegmentGroup(name, config, level);
  }

  if (config.edi_ref && ['C', 'S'].indexOf(config.edi_ref[0]) > -1) {
    return new EdiDataElement(name, config);
  }

  if (config.edi_ref) {
    return new EdiDataComponent(name, config, parent);
  }

  throw new Error('Unknown EDI type: \n' + JSON.stringify(config));
}

/**
The replacement expression based on special "EDI" characters used
*/
function getEdiEscapeRegex (config = {}) {
  return new RegExp('(['
    + config.segmentSeparator
    + config.dataElementSeparator
    + config.dataComponentSeparator
    + config.releaseCharacter
    + '])', 'g');
}

/**
Used to render out edi items but omit where there isnt any data
at the last items on the list
*/
function getListOfEdiItems (data, list, config) {
  const items = [];
  let forceAdd = false;

  for (let i = (list.length - 1); i >= 0; i--) {
    const item = list[i];
    const val = item.toEdi(data[item.name], config);

    if (val) {
      forceAdd = true;
      items.unshift(val);
    } else if (forceAdd || !item.config.canOmit) {
      // the rest of the items can be omitted
      items.unshift('');
    }
  }

  return items;
}

class EdiBase {
  constructor (name, config) {
    if (!config) {
      throw new Error('EdiBase: Config is required');
    }

    this.name = name;
    this.config = {
      __type: this.constructor.name,
      edi_order: config.edi_order,
      edi_ref: config.edi_ref,
      required: config.required,
      dataType: config.type,
      format: config.format,
    };
  }

  parseConfig (properties, level) {
    const items = [];
    for (let name in properties) {
      items.push(ediItemFromConfig(name, properties[name], level, this));
    }

    // reverse looping to ensure can omit is only up until last
    // none required property
    for (let i = items.length - 1; i >= 0; i--) {
      if (!items[i].config.required) {
        items[i].config.canOmit = true;
      } else {
        break;
      }
    }

    return _.sortBy(items, (item) => {
      return item.config.edi_order;
    });
  }

  toEdi (data, config) {
    throw new Error('toEdi: Not implemented');
  }
}

class EdiSegment extends EdiBase {
  constructor (name, config, level = 0) {
    super(name, config);
    this.config.level = level;
    this.config.tag = config.edi_tag;
    this.items = this.parseConfig(config.properties, level + 1);
  }

  toEdi (data, config) {
    if (data) {
      // if this is an "edi_ref" then this is a "DataElement" segment containing
      // "DataComponents" so  join using the "dataComponentSeparator" otherwise use the
      // "dataElementSeparator"
      var joiner = this.config.edi_ref ? config.dataComponentSeparator : config.dataElementSeparator;

      if (this.config.tag === 'UNH') {
        // Reset the total segments when a UNH is picked up
        config.totalSegments = 1;

        // Increase the total messages for the entire transfer
        config.totalMessages ++;
      } else {
        config.totalSegments ++;
      }

      var items = getListOfEdiItems(data, this.items, config);

      return this.config.tag + config.dataElementSeparator + items.join(joiner) + config.segmentSeparator;
    } else {
      return null;
    }
  }

  parse (reader) {
    if (reader.current() && reader.current().tag === this.config.tag) {
      var ret = {};

      for (var i = 0; i < this.items.length; i++) {
        var val = this.items[i].parse(reader);

        if (!_.isUndefined(val)) {
          ret[this.items[i].name] = val;
        }
      }

      reader.next();
      return ret;
    }

    return undefined;
  }
}

class EdiSegmentGroup extends EdiBase {
  constructor (name, config, level) {
    super(name, config);
    this.config.level = level;
    this.config.edi_ref = config.items.edi_ref;
    this.items = this.parseConfig(config.items.properties, level + 1);

    if (this.items.length > 0) {
      if (this.items[0].config.tag) {
        this.config.groupTag = this.items[0].config.tag;
      } else if (config.items.edi_tag) {
        // This is an group where the main item is the captcha group and the children
        // are DataElements / DataComponents
        this.config.groupTag = config.items.edi_tag;
      }
    } else {
      console.error('Error finding properties', config);
      throw new Error('EdiSegmentGroup: Requires at least one property and the first items property must have an EDI_TAG');
    }
  }

  toEdi (data, config) {
    if (_.isArray(data) && !_.isEmpty(data)) {
      var segs = [];

      for (var i = 0; i < data.length; i++) {
        var row = data[i];

        if (this.items[0].config.__type === 'EdiSegment') {
          for (let item of this.items) {
            const val = item.toEdi(row[item.name], config);

            if (val) {
              segs.push(val);
            }
          }
        } else {
          // This is an group where the main item is the captcha group and the
          // children are DataElements / DataComponents
          let seg = [];
          config.totalSegments ++;

          for (let item of this.items) {
            const val = item.toEdi(row[item.name], config);

            if (val) {
              seg.push(val);
            }
          }

          // if this is an "edi_ref" then this is a "DataElement" containing "DataComponents" so
          // join using the "dataComponentSeparator" otherwise use the "dataElementSeparator"
          let joiner = this.config.edi_ref ?
          config.dataComponentSeparator : config.dataElementSeparator;

          segs.push(this.config.groupTag + config.dataElementSeparator + seg.join(joiner) + config.segmentSeparator);
        }
      }

      segs = _.compact(segs);
      return segs.length ? segs.join('') : null;
    } else {
      return null;
    }
  }

  parse (reader) {
    var current, segs;

    // continue in the captcha group until no more matches)
    while (reader.current() && reader.current().tag === this.config.groupTag) {
      segs = segs || [];
      var val = {};

      for (let i = 0; i < this.items.length; i++) {
        var dVal = this.items[i].parse(reader);
        if (dVal) {
          val[this.items[i].name] = dVal;
        }

      }

      if (!_.isEmpty(val)) {
        segs.push(val);
      } else {
        reader.next();
      }
    }
    return segs;
  }
}

class EdiDataElement extends EdiBase {
  constructor (name, config) {
    super(name, config);
    this.items = this.parseConfig(config.properties);
  }

  toEdi (data, config) {
    if (data) {
      var items = getListOfEdiItems(data, this.items, config);
      return items.join(config.dataComponentSeparator);
    }
  }

  parse (reader) {
    var ret = {};
    for (var i = 0; i < this.items.length; i++) {
      var val = this.items[i].parse(reader);
      if (!_.isUndefined(val)) {
        ret[this.items[i].name] = val;
      }
    }

    reader.nextDataElement();

    if (!_.isEmpty(ret)) {
      return ret;
    } else {
      return undefined;
    }
  }
}

class EdiDataComponent extends EdiBase {
  constructor (name, config, parent) {
    super(name, config);
    this.config.parentConfig = parent ? parent.config : {};
  }

  toEdi (data, config) {
    // add the replace expression to the config if it isnt already set.
    config.escapeRegEx = config.escapeRegEx || getEdiEscapeRegex(config);

    if (_.isString(data)) {
      return data.replace(config.escapeRegEx, config.releaseCharacter + '$1');
    }

    return data;
  }

  parse (reader) {
    var data = reader.nextDataComponent();

    // if this parent is a segment and the segment is an DataElement
    // then fetch next data element
    // ie. FOO+1:2:3'  - Where 1,2,3 are data components
    var parentConfig = this.config.parentConfig;
    if (['EdiSegment', 'EdiSegmentGroup'].indexOf(parentConfig.__type) >= 0
      && !parentConfig.edi_ref) {
      reader.nextDataElement();
    }

    if (!_.isEmpty(data)) {
      if (this.config.dataType === 'integer' || this.config.dataType === 'number') {
        return parseInt(data, 10);
      }

      if (this.config.dataType === 'decimal') {
        return parseFloat(data);
      }

      if (this.config.dataType === 'datetime') {
        if (this.config.format === 203) {
          return moment.tz(data, 'YYYYMMDDHHmm', 'Europe/Vienna').toDate();
        }

        if (this.config.format === 303) {
          return moment(data, 'YYYYMMDDHHmmZZ').toDate();
        }
      }
      return data;
    }
    return undefined;
  }
}


class Edi extends EdiBase {

  constructor (jsonSchema) {
    super('', jsonSchema.properties);
    this.__validate(jsonSchema);
    this.jsonSchema = jsonSchema;
    helpers.flattenRefs(jsonSchema.definitions, jsonSchema);

    this.ediSchemaItems = this.parseConfig(jsonSchema.properties, 0);
  }

  toEdi (value, config) {
    this.__validateData(value);
    config = this.__getConfig(config);
    config.totalSegments = 0;
    config.totalMessages = 0;

    let edis = [];

    for (let item of this.ediSchemaItems) {
      // Special case for UNT + UNZ
      if (item.config.tag === 'UNT') {
        value[item.name] = value[item.name] || {};
        value[item.name].numberOfSegmentsInMessage = config.totalSegments + 1;
      } else if (item.config.tag === 'UNZ') {
        value[item.name] = value[item.name] || {};
        value[item.name].interchangeControlCount = config.totalMessages;
      }

      edis.push(item.toEdi(value[item.name], config));
    }

    return _.compact(edis).join('');
  }

  parse (reader) {
    var current = reader.current();
    var ret = {};

    for (let item of this.ediSchemaItems) {
      var val = item.parse(reader);
      if (!_.isUndefined(val)) {
        ret[item.name] = val;
      }
    }

    return ret;
  }

  // privates
  __validate (jsonSchema) {
    if (jsonSchema.type !== 'object') {
      throw new Error('Root type must be an \'object\'');
    }
  }

  __validateData (data) {
    let result = new Validator().validate(data, this.jsonSchema);
    if (!result.valid) {
      throw new JsonSchemaValidationError(result.errors);
    }
  }

  __getConfig (config = {}) {
    config = _.clone(config);
    config.segmentSeparator = config.segmentSeparator || '\'\n';
    config.dataElementSeparator = config.dataElementSeparator || '+';
    config.dataComponentSeparator = config.dataComponentSeparator || ':';
    config.releaseCharacter = config.releaseCharacter || '?';
    return config;
  }
}

class EdiSegmentReader {

  constructor (input, config) {
    this.config = config;
    this.segments = this.initSegments(input);
  }

  initSegments (input) {
    let items = this.regexSplitter(input, this.config.segmentSeparator,
      this.config.releaseCharacter);
    let segments = [];
    for (var i = 0; i < items.length; i++) {
      var dataElms = this.regexSplitter(items[i], this.config.dataElementSeparator,
        this.config.releaseCharacter);
      var seg = {
        tag: dataElms[0],
        dataElements: [],
        value: items[i],
      };

      for (var j = 1; j < dataElms.length; j++) {
        var comps = this.regexSplitter(dataElms[j], this.config.dataComponentSeparator, this.config.releaseCharacter);

        for (var k = 0; k < comps.length; k++) {
          comps[k] = comps[k].replace(this.config.releaseCharacter + this.config.releaseCharacter, this.config.releaseCharacter, 'g');
        }

        seg.dataElements.push(comps);
      }

      segments.push(seg);
    }

    return segments;
  }

  regexSplitter (input, split, esc) {
    var output = [];
    var lastIndex = 0;

    input.replace(new RegExp('\\' + split, 'g'), function (val, index) {
      var es = input.substring(index, index - esc.length);
      var esAndPrev = input.substring(index, index - (esc.length * 2));

      if (es !== esc || (esAndPrev === (esc + esc))) {
        output.push(input.substring(lastIndex, index));
        lastIndex = index + split.length;
      }
    });

    // get last input items on the stack
    if (lastIndex < input.length) {
      output.push(input.substring(lastIndex));
    }

    // cleanup escape characters and trim
    for (var i = 0; i < output.length; i++) {
      output[i] = output[i].replace(esc + split, split).trim();
    }

    return output;
  }

  current () {
    return this.segments[0];
  }

  next () {
    return this.segments.shift();
  }

  currentDataElement () {
    var cur = this.current();
    return cur ? this.current().dataElements[0] : undefined;
  }

  nextDataElement () {
    var cur = this.current();
    return cur ? this.current().dataElements.shift() : undefined;
  }

  currentDataComponent () {
    var de = this.currentDataElement();
    return de ? this.currentDataElement()[0] : undefined;
  }

  nextDataComponent () {
    var de = this.currentDataElement();
    return de ? this.currentDataElement().shift() : undefined;
  }
}

module.exports = {
  Edi,
  EdiSegment,
  EdiSegmentGroup,
  EdiDataElement,
  EdiDataComponent,
  EdiSegmentReader,
};
