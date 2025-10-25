class ResponseUtil {
  static success(res, message, data = null, statusCode = 200) {
    const response = {
      success: true,
      message,
      ...(data && { data })
    };
    return res.status(statusCode).json(response);
  }

  static error(res, message, statusCode = 400, errors = null) {
    const response = {
      success: false,
      message,
      ...(errors && { errors })
    };
    return res.status(statusCode).json(response);
  }

  static validationError(res, errors) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
}

module.exports = ResponseUtil;
