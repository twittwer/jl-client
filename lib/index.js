'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

require('native-promise-only');
var EventEmitter = require('event-emitter');

var _isHeartbeat = function _isHeartbeat(dataPackage) {
  return dataPackage.name && dataPackage.name === 'heartbeat';
};

var _buildUrl = function _buildUrl(requestConfig) {
  if (typeof requestConfig.path !== 'string') {
    throw new Error('Parameter Error: requestConfig.path is required and has to be a string');
  }
  var url = requestConfig.path;

  if (_typeof(requestConfig.query) === 'object') {
    var queryArray = [];

    for (var queryKey in requestConfig.query) {
      if (requestConfig.query.hasOwnProperty(queryKey)) {
        queryArray.push(queryKey + '=' + requestConfig.query[queryKey]);
      }
    }

    url = url + '?' + queryArray.join('&');
  }

  if (typeof requestConfig.ssl === 'boolean' && typeof requestConfig.host === 'string' && typeof requestConfig.port === 'number') {
    url = (requestConfig.ssl ? 'https' : 'http') + '://' + requestConfig.host + ':' + requestConfig.port + url;
  }

  return url;
};

var _preprocessRequestConfig = function _preprocessRequestConfig(requestConfig) {
  if ((typeof requestConfig === 'undefined' ? 'undefined' : _typeof(requestConfig)) !== 'object') {
    throw new Error('Missing Parameter: requestConfig is required');
  }

  requestConfig.url = _buildUrl(requestConfig);
  requestConfig.body = _typeof(requestConfig.body) === 'object' ? requestConfig.body : undefined;
};

var _preprocessModuleConfig = function _preprocessModuleConfig(moduleConfig) {
  moduleConfig.connectionTimeoutInMS = typeof moduleConfig.connectionTimeoutInMS === 'number' ? moduleConfig.connectionTimeoutInMS : 3000;
  moduleConfig.isAcknowledgeFilter = typeof moduleConfig.isAcknowledgeFilter === 'function' ? moduleConfig.isAcknowledgeFilter : _isHeartbeat;
  moduleConfig.filterAcknowledge = typeof moduleConfig.filterAcknowledge === 'boolean' ? moduleConfig.filterAcknowledge : true;
};

var JlClient = function JlClient(requestConfig, moduleConfig) {
  this._config = {
    request: requestConfig,
    module: moduleConfig || {}
  };
  this._state = {
    connected: false,
    responsePointer: 0
  };

  this._xhr = new XMLHttpRequest();
  this._server = new EventEmitter();
};

JlClient.prototype.connect = function () {
  var _this = this;

  return new Promise(function (resolve, reject) {
    _this._callbacks = {
      onConnectError: function onConnectError(error) {
        if (!_this._state.connected) {
          _this._disconnect();
          reject(error);
        }
      },
      onConnectSuccess: function onConnectSuccess() {
        _this._state.connected = true;

        _this._server.isIdle = function () {
          return _this._isIdle();
        };
        _this._server.disconnect = function () {
          return _this._disconnect();
        };

        resolve(_this._server);
      }
    };

    try {
      _preprocessRequestConfig(_this._config.request);
      _preprocessModuleConfig(_this._config.module);
    } catch (error) {
      return _this._callbacks.onConnectError(error);
    }

    _this._setReadyStateChangeListener();
    _this._xhr.open('POST', _this._config.request.url, true);
    _this._setHeaders();
    _this._xhr.send(_this._config.request.body ? JSON.stringify(_this._config.request.body) : undefined);

    _this._timeoutInspector = setTimeout(function () {
      _this._timeoutInspector = undefined;
      if (typeof _this._xhr.readyState !== 'number' || _this._xhr.readyState < 2 || !_this._state.connected) {
        _this._callbacks.onConnectError(new Error('request-timeout'));
      }
    }, _this._config.module.connectionTimeoutInMS);
  });
};

JlClient.prototype._disconnect = function () {
  this._state.connected = false;
  this._xhr.abort();
  if (this._timeoutInspector) {
    clearTimeout(this._timeoutInspector);
    this._timeoutInspector = undefined;
  }
};

JlClient.prototype._isIdle = function () {
  return this._state.responsePointer === this._xhr.response.length;
};

JlClient.prototype._setHeaders = function () {
  if (_typeof(this._config.request.headers) === 'object') {
    for (var headerName in this._config.request.headers) {
      if (this._config.request.headers.hasOwnProperty(headerName)) {
        this._xhr.setRequestHeader(headerName, this._config.request.headers[headerName]);
      }
    }
  }
  this._xhr.setRequestHeader('content-type', 'application/json');
};

JlClient.prototype._setReadyStateChangeListener = function () {
  var _this2 = this;

  this._xhr.onreadystatechange = function () {
    switch (_this2._xhr.readyState) {
      case 2:
        _this2._handleHeadersReceived(_this2._xhr.status);
        break;
      case 3:
        _this2._handleLoading(_this2._xhr.status, _this2._xhr.response);
        break;
      case 4:
        _this2._handleDone(_this2._xhr.status);
        break;
      default:
    }
  };
};

JlClient.prototype._handleHeadersReceived = function (statusCode) {
  if (statusCode !== 200) {
    this._callbacks.onConnectError(new Error('http-error'));
  }
};

JlClient.prototype._handleLoading = function (statusCode, response) {
  if (statusCode !== 200 || typeof response !== 'string' || this._state.responsePointer >= response.length) {
    return;
  }

  try {
    var dataChunk = response.substring(this._state.responsePointer, response.length - 1);
    var dataStrings = dataChunk.split('\n');

    for (var processingIndex = 0; processingIndex < dataStrings.length; processingIndex++) {
      var dataPackage = JSON.parse(dataStrings[processingIndex]);

      this._handleDataPackage(dataPackage);
      this._state.responsePointer += dataStrings[processingIndex].length + 1;
    }
  } catch (error) {}

  this._server.emit('responseLength', this._xhr.response.length);
};

JlClient.prototype._handleDone = function (statusCode) {
  if (statusCode === 200) {
    if (!this._state.connected) {
      return this._callbacks.onConnectError(new Error('request-rejected'));
    }
    this._server.emit('disconnect');
  } else {
    if (!this._state.connected) {
      return;
    }
    this._server.emit('disconnect', new Error(statusCode !== 0 ? 'http-abort' : 'network-error' + statusCode));
  }
  this._disconnect();
};

JlClient.prototype._handleDataPackage = function (dataPackage) {
  if ((typeof dataPackage === 'undefined' ? 'undefined' : _typeof(dataPackage)) === 'object') {
    if (!this._state.connected) {
      if (!this._config.module.isAcknowledgeFilter(dataPackage)) {
        return;
      }
      this._callbacks.onConnectSuccess();
      if (this._config.module.filterAcknowledge) {
        return;
      }
    }

    if (_isHeartbeat(dataPackage)) {
      this._server.emit('heartbeat');
    } else {
      this._server.emit('data', dataPackage);
    }
  }
};

module.exports = {
  connect: function connect(requestConfig, moduleConfig) {
    return new JlClient(requestConfig, moduleConfig).connect();
  }
};