const { validationResult } = require('express-validator');
const ResponseUtil = require('../utils/response.util');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return ResponseUtil.validationError(res, errors);
  }
  next();
};

module.exports = validate;
