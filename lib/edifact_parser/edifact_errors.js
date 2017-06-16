'use strict';
class RequiredPropertyError extends Error {
  constructor (config = {}) {
    super();
    ({ propertyName: this.propertyName, causingSchema: this.causingSchema, segment: this.segment, filledData: this.filledData } = config);
    this.message = `Required property is missing: "${this.propertyName}":\n${JSON.stringify(this, null, 2)}`;
  }
}

class JsonSchemaValidationError extends Error {
  constructor (errors) {
    super(`Json Schema Validation Errors:\n${JSON.stringify(errors, null, 2)}`);
    this.errors = errors;
  }
}

module.exports = {
  RequiredPropertyError: RequiredPropertyError,
  JsonSchemaValidationError: JsonSchemaValidationError,
};
